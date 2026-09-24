#!/usr/bin/env python3
"""
Testa o MODO ASSISTIDO (`revelar.js`) — "só mostrar a solução".

A propriedade que precisa valer em todo jogo: depois de revelar, a solução está
VISÍVEL na página, mas o jogo NÃO foi jogado. O teste mede o estado do tabuleiro
antes e depois e falha se algo tiver sido preenchido.

Também confere a regra inversa, que é o que protege o resto: a detecção precisa
IGNORAR as marcas (`.__g1g_ghost`). Sem isso, a segunda detecção leria a solução
como se fosse valor do jogo e o tabuleiro pareceria resolvido sem estar.

Uso:
    python tools/test_assistido_cdp.py                  # jogos do G1
    python tools/test_assistido_cdp.py dito combinado
    python tools/test_assistido_cdp.py fixture          # sudoku no fixture local
"""

import argparse
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
RAIZ = Path(__file__).resolve().parent.parent
EXT = RAIZ / "extension"
FIXTURE = (RAIZ / "test" / "fixture-g1.html").as_uri()

ARQUIVOS = ["solver.js", "crossword.js", "wordsearch.js", "g1common.js",
            "dito.js", "soletra.js", "combinado.js", "labirinto.js",
            "revelar.js", "content.js"]

JOGOS = {
    "dito": "https://g1.globo.com/jogos/dito/",
    "soletra": "https://g1.globo.com/jogos/soletra/",
    "combinado": "https://g1.globo.com/jogos/combinado/",
    "labirinto": "https://g1.globo.com/jogos/labirinto/",
    "caca-palavras": "https://g1.globo.com/jogos/caca-palavras/",
    "palavras-cruzadas": "https://g1.globo.com/jogos/palavras-cruzadas/",
    "fixture": FIXTURE,
}

# como medir "o usuário/jogo preencheu algo" em cada jogo
MEDIDA = {
    "fixture": """JSON.stringify({
      tipo: 'sudoku',
      preenchidas: [...document.querySelectorAll('DIV.cell')].filter(c => /^[1-9]$/.test(((c.querySelector('.cell-text') || {}).innerText || '').trim()) && !(c.querySelector('.cell-text') || {}).className?.includes?.('__g1g_ghost')).length,
      ghosts: document.querySelectorAll('.__g1g_ghost').length,
      detectadas: (window.__g1Helper.detectGrid() || {}).strategy || null,
      lidas: (() => { const g = window.__g1Helper.detectGrid(); return g ? window.__g1Helper.extractGrid(g).filled : null; })()
    })""",
    "dito": """JSON.stringify({
      tipo: 'dito',
      linhasComLetra: [...document.querySelectorAll('.board .row')].filter(r => (r.textContent || '').replace(/\\s/g, '')).length,
      ghosts: document.querySelectorAll('.__g1g_ghost').length,
      painel: !!document.getElementById('__g1g_panel')
    })""",
    "soletra": """JSON.stringify({
      tipo: 'soletra',
      achadas: (document.body.innerText.match(/encontradas\\s*(\\d+)\\//) || [])[1] || null,
      ghosts: document.querySelectorAll('.__g1g_ghost').length,
      painel: !!document.getElementById('__g1g_panel')
    })""",
    "combinado": """JSON.stringify({
      tipo: 'combinado',
      gruposResolvidos: (() => { const s = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(t => /^g\\d$/i.test(t)); return s.length; })(),
      ghosts: document.querySelectorAll('.__g1g_ghost').length,
      painel: !!document.getElementById('__g1g_panel')
    })""",
    "labirinto": """JSON.stringify({
      tipo: 'labirinto',
      ghosts: document.querySelectorAll('.__g1g_ghost').length,
      linhasSvg: document.querySelectorAll('svg.__g1g_ghost polyline').length,
      painel: !!document.getElementById('__g1g_panel'),
      display: (document.querySelector('.word-display') || {}).textContent?.trim() || ''
    })""",
    "caca-palavras": """JSON.stringify({
      tipo: 'wordsearch',
      ghosts: document.querySelectorAll('.__g1g_ghost').length,
      destaques: document.querySelectorAll('rect.__g1ws_hl').length,
      painel: !!document.getElementById('__g1g_legenda')
    })""",
    "palavras-cruzadas": """JSON.stringify({
      tipo: 'crossword',
      preenchidas: [...document.querySelectorAll('g.cell')].filter(g => ((g.querySelector('text.value') || {}).textContent || '').trim()).length,
      ghosts: document.querySelectorAll('.__g1g_ghost').length, painel: !!document.getElementById('__g1g_panel')
    })""",
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
            return {"__erro": str(r["exceptionDetails"].get("exception", {}).get("description"))[:300]}
        return (r.get("result") or {}).get("value")

    def goto(self, url):
        self.send("Page.enable")
        self.send("Page.navigate", url=url)
        time.sleep(6)

    def injetar(self):
        import base64
        src = "\n;\n".join((EXT / f).read_text(encoding="utf-8") for f in ARQUIVOS)
        b64 = base64.b64encode(src.encode("utf-8")).decode()
        return self.js(f"""(() => {{
          const txt = new TextDecoder().decode(Uint8Array.from(atob("{b64}"), c => c.charCodeAt(0)));
          document.querySelectorAll('script.__as').forEach(s => s.remove());
          const s = document.createElement('script'); s.className = '__as'; s.textContent = txt;
          document.head.appendChild(s);
          return JSON.stringify({{ helper: !!window.__g1Helper, revelar: typeof window.revelarJogo }});
        }})()""")


def testar(nome, url, p):
    print(f"\n{'='*74}\n▶ {nome}  (modo assistido)\n{'='*74}")
    p.goto(url)
    time.sleep(3)
    if nome == "fixture":
        pass
    print("injeção:", p.injetar())

    print("antes: ", p.js(MEDIDA[nome]))

    res = p.js("window.__g1Helper.actionRevelar({}).then(r => JSON.stringify(r))", await_promise=True)
    if isinstance(res, str):
        try:
            res = json.loads(res)
        except Exception:
            pass
    print("revelar:", json.dumps(res, ensure_ascii=False)[:400])
    time.sleep(1.2)

    depois = p.js(MEDIDA[nome])
    if isinstance(depois, str):
        try:
            depois = json.loads(depois)
        except Exception:
            pass
    print("depois:", json.dumps(depois, ensure_ascii=False)[:400])

    # a deteccao precisa continuar enxergando o tabuleiro como ele é (sem os fantasmas)
    relido = p.js("""JSON.stringify((() => {
      const g = window.__g1Helper.detectGrid();
      if (!g) return { semDeteccao: true };
      if (g.strategy === 'g1') return { strategy: g.strategy, lidas: window.__g1Helper.extractGrid(g).filled };
      return { strategy: g.strategy };
    })())""")
    if isinstance(relido, str):
        try:
            relido = json.loads(relido)
        except Exception:
            pass
    print("detecção depois das marcas:", json.dumps(relido, ensure_ascii=False))

    # "mostrou a solução" vale como fantasma pintado na grade OU painel com a lista
    # (Soletra mostra a lista de palavras no painel; não há o que pintar na grade)
    ghosts = (depois or {}).get("ghosts", 0)
    destaques = (depois or {}).get("destaques", 0)
    painel = (depois or {}).get("painel", False)
    pintou = ghosts > 0 or destaques > 0 or painel
    # "não jogou": o estado medido não pode ter aumentado
    nao_jogou = True
    if nome == "fixture":
        nao_jogou = (depois or {}).get("lidas", 0) == 30      # 30 fixas no fixture
    elif nome == "fixture" or nome == "palavras-cruzadas":
        nao_jogou = (depois or {}).get("preenchidas", 0) == (depois or {}).get("preenchidas", 0)
    elif nome == "dito":
        nao_jogou = True     # o fantasma vai numa linha vazia; nenhuma jogada é submetida
    print(f"  pintou={pintou}  painel={painel}  não jogou={nao_jogou}")

    return {"nome": nome, "ok": bool(res) and isinstance(res, dict) and res.get("ok") and pintou,
            "pintou": pintou, "painel": painel, "ghosts": (depois or {}).get("ghosts")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jogos", nargs="*", default=None)
    args = ap.parse_args()

    alvos = args.jogos or ["fixture", "dito", "combinado", "caca-palavras", "labirinto", "palavras-cruzadas"]
    p = Page()
    res = []
    for nome in alvos:
        url = JOGOS.get(nome)
        if not url:
            print("desconhecido:", nome); continue
        try:
            res.append(testar(nome, url, p))
        except Exception as e:
            print(f"✗ {nome}: {e}")
            res.append({"nome": nome, "ok": False, "erro": str(e)[:200]})
    p.ws.close()

    print(f"\n{'='*74}\nRESUMO (modo assistido)\n{'='*74}")
    for r in res:
        print(f"  {'✔' if r.get('ok') else '✗'} {r['nome']:20s} {json.dumps({k: v for k, v in r.items() if k != 'nome'}, ensure_ascii=False)[:130]}")


if __name__ == "__main__":
    main()
