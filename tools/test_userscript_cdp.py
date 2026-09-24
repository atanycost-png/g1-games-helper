#!/usr/bin/env python3
"""
Testa o USERSCRIPT (userscript/g1-games-helper.user.js) numa página real.

Injeta o arquivo .user.js inteiro na página exatamente como o Tampermonkey faria
(ele roda no contexto da página quando não há grants disponíveis — aqui os GM_*
não existem, então o fallback para localStorage é exercitado de propósito) e
verifica:

  1. o arquivo parseia e o menu (botão 🧩 + cartão) é montado;
  2. a detecção reconhece o jogo da página;
  3. a ação do jogo roda e reporta sucesso.

É o teste que separa "gerou o arquivo" de "o arquivo funciona".

Uso:
    python tools/test_userscript_cdp.py                 # caça-palavras (rápido)
    python tools/test_userscript_cdp.py dito soletra    # jogos específicos
"""

import argparse
import base64
import json
import sys
import time
import urllib.request
from pathlib import Path

try:
    import websocket
except ImportError:
    sys.exit("falta websocket-client:  pip install websocket-client")

CDP_HTTP = "http://127.0.0.1:9222"
ARQUIVO = Path(__file__).resolve().parent.parent / "userscript" / "g1-games-helper.user.js"

JOGOS = {
    "dito": "https://g1.globo.com/jogos/dito/",
    "soletra": "https://g1.globo.com/jogos/soletra/",
    "combinado": "https://g1.globo.com/jogos/combinado/",
    "labirinto": "https://g1.globo.com/jogos/labirinto/",
    "caca-palavras": "https://g1.globo.com/jogos/caca-palavras/",
    "palavras-cruzadas": "https://g1.globo.com/jogos/palavras-cruzadas/",
    "sudoku": "https://g1.globo.com/jogos/sudoku/",
}
ESPERADO = {
    "dito": "dito", "soletra": "soletra", "combinado": "combinado",
    "labirinto": "labirinto", "caca-palavras": "wordsearch",
    "palavras-cruzadas": "crossword", "sudoku": "g1",
}


class Page:
    def __init__(self):
        with urllib.request.urlopen(CDP_HTTP + "/json/list", timeout=5) as r:
            tabs = [x for x in json.load(r) if x.get("type") == "page"]
        self.ws = websocket.create_connection(tabs[0]["webSocketDebuggerUrl"], timeout=900, max_size=None)
        self._id = 0

    def send(self, method, **params):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def js(self, expr, await_promise=False):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=await_promise)
        if r.get("exceptionDetails"):
            return {"__erro": str(r["exceptionDetails"].get("exception", {}).get("description"))[:400]}
        return (r.get("result") or {}).get("value")

    def goto(self, url):
        self.send("Page.enable")
        self.send("Page.navigate", url=url)
        time.sleep(6)


def injetar(p, b64):
    return p.js(f"""(() => {{
      const txt = new TextDecoder().decode(Uint8Array.from(atob("{b64}"), c => c.charCodeAt(0)));
      document.querySelectorAll('script.__usr').forEach(s => s.remove());
      const s = document.createElement('script');
      s.className = '__usr'; s.textContent = txt;
      document.head.appendChild(s);
      return JSON.stringify({{ ui: !!window.__g1UI, helper: !!window.__g1Helper }});
    }})()""")


def testar(nome, url, p, b64):
    print(f"\n{'='*72}\n▶ {nome}  (userscript)\n{'='*72}")
    p.goto(url)
    time.sleep(3)

    print("injeção:", injetar(p, b64))
    time.sleep(1.5)          # o arranque espera 300ms + montagem do menu

    # a detecção passou a incluir "garantir o jogo aberto" (clicar em Iniciar),
    # então ela demora alguns segundos — esperar aqui, não assumir.
    detectou = False
    for _ in range(40):
        st = p.js("JSON.stringify({ d: !!window.__g1UI.detectado, j: (document.getElementById('__g1u_jogo') || {}).textContent })")
        try:
            st = json.loads(st)
        except Exception:
            st = {}
        if st.get("d"):
            detectou = True
            break
        time.sleep(0.75)
    print("detecção concluída:", detectou)

    estado = p.js("""JSON.stringify({
      botao: !!document.getElementById('__g1u_btn'),
      cartao: !!document.getElementById('__g1u_card'),
      chips: document.querySelectorAll('#__g1u_chips .chip').length,
      jogo: (document.getElementById('__g1u_jogo') || {}).textContent,
      info: (document.getElementById('__g1u_info') || {}).textContent,
      acao: (document.getElementById('__g1u_acao') || {}).textContent
    })""")
    if isinstance(estado, str):
        estado = json.loads(estado)
    print("menu na página:", json.dumps(estado, ensure_ascii=False))

    if not estado.get("botao"):
        return {"nome": nome, "ok": False, "etapa": "menu"}
    if estado.get("chips") != 7:
        print(f"⚠️  esperava 7 chips, achei {estado.get('chips')}")

    # abre o cartão pelo botão e roda a ação
    aberto = p.js("""(() => { document.getElementById('__g1u_btn').click();
      return JSON.stringify({ visivel: !document.getElementById('__g1u_card').hidden }); })()""")
    print("clique no botão:", aberto)

    res = p.js("""window.__g1UI.executar().then(() => JSON.stringify({
      log: (document.getElementById('__g1u_log') || {}).textContent,
      aviso: (document.getElementById('__g1u_aviso') || {}).textContent,
      // evidência no DOM (não confiar só no texto que o próprio script escreveu)
      destaques: document.querySelectorAll('rect.__g1ws_hl').length,
      painel: !!document.getElementById('__g1g_panel'),
      linhasComLetra: [...document.querySelectorAll('.board .row')].filter(r => (r.textContent||'').trim()).length
    }))""", await_promise=True)
    if isinstance(res, str):
        try:
            res = json.loads(res)
        except Exception:
            pass
    print("resultado:", json.dumps(res, ensure_ascii=False)[:400])

    detectado = p.js("""JSON.stringify((() => {
      const d = window.__g1UI.detectado;
      return d ? { s: d.strategy, f: !!d.found } : null;
    })())""")
    print("detecção (após a ação):", detectado)
    try:
        d = json.loads(detectado) or {}
    except Exception:
        d = {}

    ev = res if isinstance(res, dict) else {}
    prova = {
        "caca-palavras": ev.get("destaques", 0) > 0,
        "dito": ev.get("linhasComLetra", 0) > 0,
        "sudoku": ev.get("painel", False),
    }.get(nome, ev.get("painel", False) or bool(ev.get("log")))
    ok = (bool(res) and isinstance(res, dict) and bool(ev.get("log"))
          and not str(ev.get("log")).startswith("erro") and prova)
    if d.get("s") and d["s"] != ESPERADO.get(nome):
        print(f"⚠️  estratégia {d.get('s')} (esperava {ESPERADO.get(nome)})")
    return {"nome": nome, "ok": ok, "jogo": estado.get("jogo"), "log": (res or {}).get("log")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jogos", nargs="*", default=None)
    args = ap.parse_args()

    if not ARQUIVO.exists():
        sys.exit("rode tools/build_userscript.py primeiro")
    src = ARQUIVO.read_bytes()
    b64 = base64.b64encode(src).decode()
    print(f"userscript: {ARQUIVO.name} · {len(src):,} bytes")

    alvos = args.jogos or ["caca-palavras"]
    p = Page()
    res = []
    for nome in alvos:
        url = JOGOS.get(nome)
        if not url:
            print("desconhecido:", nome)
            continue
        try:
            res.append(testar(nome, url, p, b64))
        except Exception as e:
            print(f"✗ {nome}: {e}")
            res.append({"nome": nome, "ok": False, "erro": str(e)[:200]})
    p.ws.close()

    print(f"\n{'='*72}\nRESUMO (userscript)\n{'='*72}")
    for r in res:
        print(f"  {'✔' if r.get('ok') else '✗'} {r['nome']:20s} {json.dumps({k: v for k, v in r.items() if k != 'nome'}, ensure_ascii=False)[:160]}")


if __name__ == "__main__":
    main()
