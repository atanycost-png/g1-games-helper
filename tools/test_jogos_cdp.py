#!/usr/bin/env python3
"""
Testa os módulos da extensão em cada jogo do G1, FORA da extensão.

Injeta os arquivos reais (g1common + módulos + content) na página via CDP e roda
`window.__g1Helper.actionDetect()` e `actionAuto({human:false})`, imprimindo o
resultado. É o mesmo caminho que o popup usa quando a aba já está pronta — serve
para validar detecção, leitura do JSON do site e o preenchimento de cada jogo.

Uso:
    python test_jogos_cdp.py                # todos os jogos
    python test_jogos_cdp.py dito soletra   # só alguns

Requer Edge/Chrome em --remote-debugging-port=9222. Dependência: websocket-client.
"""

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
EXT = Path(__file__).resolve().parent.parent / "extension"

ARQUIVOS = ["solver.js", "crossword.js", "wordsearch.js", "g1common.js",
            "dito.js", "soletra.js", "combinado.js", "labirinto.js", "content.js"]

JOGOS = {
    "dito": "https://g1.globo.com/jogos/dito/",
    "soletra": "https://g1.globo.com/jogos/soletra/",
    "combinado": "https://g1.globo.com/jogos/combinado/",
    "labirinto": "https://g1.globo.com/jogos/labirinto/",
    "caca-palavras": "https://g1.globo.com/jogos/caca-palavras/",
    "palavras-cruzadas": "https://g1.globo.com/jogos/palavras-cruzadas/",
}


class Page:
    def __init__(self, url=None):
        t = self._target(url)
        # timeout alto: actions longas (soletra digitando 29 palavras) deixam o
        # socket ocioso e o default de 90s derruba a conexão no meio.
        self.ws = websocket.create_connection(t["webSocketDebuggerUrl"], timeout=900, max_size=None)
        self._id = 0

    @staticmethod
    def _target(url=None):
        with urllib.request.urlopen(CDP_HTTP + "/json/list", timeout=5) as r:
            tabs = [x for x in json.load(r) if x.get("type") == "page"]
        if url:
            for t in tabs:
                if url in (t.get("url") or ""):
                    return t
        return tabs[0]

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
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True,
                      awaitPromise=await_promise)
        if r.get("exceptionDetails"):
            return {"__erro": str(r["exceptionDetails"].get("exception", {}).get("description"))[:300]}
        return (r.get("result") or {}).get("value")

    def goto(self, url):
        self.send("Page.enable")
        self.send("Page.navigate", url=url)
        time.sleep(6)

    def close(self):
        self.ws.close()


def injetar(p):
    src = "\n;\n".join((EXT / f).read_text(encoding="utf-8") for f in ARQUIVOS if (EXT / f).exists())
    p.js("(() => { window.__g1Helper = null; })()")
    # injeta por script tag para manter o escopo isolado do resto da página
    b64 = __import__("base64").b64encode(src.encode("utf-8")).decode()
    r = p.js(f"""(() => {{
      const txt = new TextDecoder().decode(Uint8Array.from(atob("{b64}"), c => c.charCodeAt(0)));
      document.querySelectorAll('script.__g1t').forEach(s => s.remove());
      const s = document.createElement('script');
      s.className = '__g1t'; s.textContent = txt;
      document.head.appendChild(s);
      return JSON.stringify({{ helper: !!window.__g1Helper, common: !!window.__g1g }});
    }})()""")
    return r


ID_POR_ACAO = {
    "dito": "dito", "soletra": "soletra", "combinado": "combinado",
    "labirinto": "labirinto", "caca-palavras": "wordsearch",
    "palavras-cruzadas": "crossword",
}


def testar(nome, url, p):
    print(f"\n{'='*72}\n▶ {nome}  ({url})\n{'='*72}")
    p.goto(url)
    time.sleep(3)
    print("injeção:", injetar(p))

    # ⚠️ JSON.stringify(promise) devolve "{}" — precisa do .then
    det = p.js("window.__g1Helper ? window.__g1Helper.actionDetect().then(r => JSON.stringify(r)) : 'null'",
               await_promise=True)
    print("detect:", str(det)[:400])
    try:
        d = json.loads(det) if det else {}
    except Exception:
        d = {}

    esperado = ID_POR_ACAO.get(nome)
    if not d.get("found"):
        print("⚠️  não detectou")
        return {"nome": nome, "ok": False, "etapa": "detect"}

    if d.get("strategy") != esperado:
        print(f"⚠️  estratégia {d.get('strategy')} (esperava {esperado})")

    if nome == "labirinto":
        plano = p.js("window.labirintoPlano({fast:true}).then(r => JSON.stringify(r))", await_promise=True)
        try:
            pl = json.loads(plano)
            print(f"plano: {pl.get('word')} · {pl.get('totalCasas')} casas · "
                  f"{len(pl.get('pontos') or [])} pontos · setas {pl.get('direcoes','')[:20]}…")
            print(f"1º ponto: {pl['pontos'][0]}  último: {pl['pontos'][-1]}")
            return {"nome": nome, "ok": True, "palavra": pl.get("word"), "casas": pl.get("totalCasas")}
        except Exception as e:
            print("plano falhou:", str(plano)[:200], e)
            return {"nome": nome, "ok": False, "etapa": "plano"}

    res = p.js("window.__g1Helper.actionAuto({human:false}).then(r => JSON.stringify(r))", await_promise=True)
    print("auto:", str(res)[:700])
    try:
        r = json.loads(res) if res else {}
    except Exception:
        r = {}
    return {"nome": nome, "ok": bool(r.get("success")), "resultado": r}


def main():
    alvos = sys.argv[1:] or ["dito", "soletra", "combinado", "labirinto", "caca-palavras", "palavras-cruzadas"]
    p = Page()
    res = []
    for nome in alvos:
        url = JOGOS.get(nome)
        if not url:
            print("desconhecido:", nome)
            continue
        try:
            res.append(testar(nome, url, p))
        except Exception as e:
            print(f"✗ {nome}: {e}")
            res.append({"nome": nome, "ok": False, "erro": str(e)[:200]})
    p.close()

    print(f"\n\n{'='*72}\nRESUMO\n{'='*72}")
    for r in res:
        print(f"  {'✔' if r.get('ok') else '✗'} {r['nome']:22s} {json.dumps({k: v for k, v in r.items() if k not in ('nome',)}, ensure_ascii=False)[:180]}")


if __name__ == "__main__":
    main()
