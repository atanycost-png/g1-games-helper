#!/usr/bin/env python3
"""
Resolve o Labirinto do G1 (g1.globo.com/jogos/labirinto) via CDP.

Por que existe: o tabuleiro é um <canvas> e o jogo registra
`mousedown/mousemove/mouseup` nele (lendo `clientX/clientY`). Este script valida,
fora da extensão, o caminho que o `background.js` usa (chrome.debugger →
Input.dispatchMouseEvent) e serve de referência para o `labirinto.js`.

O gabarito vem do JSON estático do site:
    https://g1.globo.com/jogos/static/labirinto.json
      { word, clue, rows, cols, letter_positions[[row,col,letra],...],
        solution_path[[row,col],...], walls[..] }

Geometria: o canvas é 336 CSS px (com dpr aplicado no buffer interno) e a grade
do dia é `rows`x`cols`; célula = floor(canvasSize / gridSize) em CSS px.

Uso:
    python solve_labirinto_cdp.py --check     # só estado + caminho
    python solve_labirinto_cdp.py             # desenha o caminho (modo humano)
    python solve_labirinto_cdp.py --fast      # sem interpolação/pausas

Requer: Edge/Chrome em --remote-debugging-port=9222 com a aba do labirinto e o
jogo iniciado. Dependência: websocket-client.
"""

import argparse
import json
import sys
import time
import urllib.request

try:
    import websocket  # websocket-client
except ImportError:
    sys.exit("falta websocket-client:  pip install websocket-client")

CDP_HTTP = "http://127.0.0.1:9222"
JSON_URL = "/jogos/static/labirinto.json"


def find_target(url_part):
    with urllib.request.urlopen(CDP_HTTP + "/json/list", timeout=5) as r:
        for t in json.load(r):
            if t.get("type") == "page" and url_part in (t.get("url") or ""):
                return t
    return None


class Page:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=40, max_size=None)
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
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True,
                      awaitPromise=await_promise)
        return (r.get("result") or {}).get("value")

    def mouse(self, kind, x, y, buttons=0, click_count=1):
        self.send("Input.dispatchMouseEvent", type=kind, x=int(round(x)), y=int(round(y)),
                  button="left" if buttons or kind == "mouseReleased" else "none",
                  buttons=buttons, clickCount=click_count)

    def close(self):
        self.ws.close()


JS_ESTADO = """
JSON.stringify((() => {
  const cv = document.querySelector('.labirinto-canvas__canvas');
  const wd = document.querySelector('.word-display');
  const r = cv ? cv.getBoundingClientRect() : null;
  const bloq = document.querySelector('.tour-spotlight, .tour-backdrop, .drawer-overlay');
  return {
    canvas: r ? { l: r.left, t: r.top, w: r.width, h: r.height, iw: cv.width, ih: cv.height } : null,
    display: wd ? (wd.textContent || '').replace(/\\s+/g, ' ').trim() : null,
    bloqueio: !!bloq && bloq.getBoundingClientRect().width > 0 ? String(bloq.className) : null,
    timer: (document.querySelector('.timer') || {}).textContent || null,
    pontos: (document.body.innerText.match(/(\\d+)\\/(\\d+)/) || [])[0] || null
  };
})())
"""


def estado(p):
    return json.loads(p.js(JS_ESTADO))


def fechar_bloqueios(p):
    """Fecha o tour de boas-vindas e o drawer 'Como jogar' (cobrem o canvas)."""
    fechados = 0
    for _ in range(8):
        r = p.js("""(() => {
          const vis = e => e && e.getBoundingClientRect().width > 0;
          const btn = [...document.querySelectorAll('button')]
            .filter(b => vis(b) && /^(Avançar|Próximo|Entendi|Ok|Fechar|Pular)$/i.test((b.textContent||'').trim()));
          if (btn.length) { btn[0].click(); return (btn[0].textContent||'').trim(); }
          const ov = document.querySelector('.drawer-overlay');
          if (vis(ov)) { ov.style.display = 'none'; return 'overlay-escondido'; }
          return null;
        })()""")
        if not r:
            break
        fechados += 1
        time.sleep(0.7)
    return fechados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="só mostra o estado e o caminho")
    ap.add_argument("--fast", action="store_true", help="sem interpolação/pausas")
    ap.add_argument("--port", type=int, default=9222)
    args = ap.parse_args()

    global CDP_HTTP
    CDP_HTTP = f"http://127.0.0.1:{args.port}"

    t = find_target("/jogos/labirinto")
    if not t:
        sys.exit("nenhuma aba do labirinto encontrada no CDP")
    p = Page(t["webSocketDebuggerUrl"])

    puz = json.loads(p.js(f"fetch('{JSON_URL}', {{cache:'no-store'}}).then(r => r.text())", await_promise=True))
    path = puz["solution_path"]
    print(f"palavra: {puz['word']}  |  dica: {puz['clue']}")
    print(f"grade {puz['rows']}x{puz['cols']}  |  caminho: {len(path)} células")

    e = estado(p)
    print(f"canvas: {e['canvas']}  |  display: {e['display']!r}  |  bloqueio: {e['bloqueio']}  |  timer: {e['timer']}")

    if e["bloqueio"]:
        n = fechar_bloqueios(p)
        print(f"bloqueios fechados: {n}")
        time.sleep(0.8)
        e = estado(p)
        print(f"depois: display={e['display']!r} bloqueio={e['bloqueio']}")

    if args.check:
        linhas = " -> ".join(f"{r},{c}" for r, c in path[:8])
        print(f"caminho (início): {linhas} ...")
        p.close()
        return

    cv = e["canvas"]
    if not cv:
        sys.exit("canvas não encontrado")
    cel = cv["w"] / puz["cols"]

    # ATENÇÃO: as coordenadas do JSON (e do próprio jogo) são [col, row] —
    # `Qt(x,y,...)` devolve `[floor(x/cel), floor(y/cel)]`. Transpor aqui faz o
    # caminho sair torto e o jogo coletar letras fora de ordem.
    def pt(col, row):
        return (cv["l"] + (col + 0.5) * cel, cv["t"] + (row + 0.5) * cel)

    print(f"célula: {cel:.1f} CSS px  |  desenhando o caminho…")

    x0, y0 = pt(*path[0])
    p.mouse("mouseMoved", x0, y0, 0)
    time.sleep(0.25)
    p.mouse("mousePressed", x0, y0, 1)
    time.sleep(0.35)

    for i in range(1, len(path)):
        ax, ay = pt(*path[i - 1])
        bx, by = pt(*path[i])
        passos = 1 if args.fast else 6
        for s in range(1, passos + 1):
            p.mouse("mouseMoved", ax + (bx - ax) * s / passos, ay + (by - ay) * s / passos, 1)
            if not args.fast:
                time.sleep(0.03)
        if not args.fast and i % 6 == 0:
            time.sleep(0.12)

    ex, ey = pt(*path[-1])
    time.sleep(0.25)
    p.mouse("mouseReleased", ex, ey, 0)
    time.sleep(1.5)

    e = estado(p)
    print(f"\nRESULTADO: display={e['display']!r}  pontos={e['pontos']}")
    print(f"palavra esperada: {puz['word']}")
    txt = p.js("document.body.innerText.replace(/\\s+/g,' ').slice(0,220)")
    print(f"tela: {txt}")
    p.close()


if __name__ == "__main__":
    main()
