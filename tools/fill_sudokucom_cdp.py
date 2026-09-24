#!/usr/bin/env python3
"""
Preenche o sudoku.com via CDP — input REAL (Input.dispatchMouseEvent).

Por que existe: valida, fora da extensão, o exato caminho que o `background.js`
usa (chrome.debugger → Input.dispatchMouseEvent). O jogo é um <canvas> e ignora
eventos sintéticos (dispatchEvent), então input real é obrigatório.

Uso:
    python fill_sudokucom_cdp.py --check      # só mostra estado/plano
    python fill_sudokucom_cdp.py             # despausa e preenche (modo humano)
    python fill_sudokucom_cdp.py --fast      # sem movimento interpolado

Requer: Edge/Chrome com --remote-debugging-port=9222 e uma aba do sudoku.com
com um jogo iniciado. Dependência: websocket-client.
"""

import argparse
import json
import random
import sys
import time
import urllib.request

try:
    import websocket  # websocket-client
except ImportError:
    sys.exit("falta websocket-client:  pip install websocket-client")

CDP_HTTP = "http://127.0.0.1:9222"


# ─────────────────────────────────────────────────────────────────────────────
# CDP
# ─────────────────────────────────────────────────────────────────────────────

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
            # eventos (sem id) são ignorados

    def js(self, expr):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(r["exceptionDetails"].get("text", "erro de JS"))
        return r.get("result", {}).get("value")

    # input ---------------------------------------------------------------

    def move_mouse(self, frm, to, human=True):
        if not human:
            self.send("Input.dispatchMouseEvent", type="mouseMoved",
                      x=int(to[0]), y=int(to[1]), button="none", buttons=0)
            return
        dist = ((to[0] - frm[0]) ** 2 + (to[1] - frm[1]) ** 2) ** 0.5
        steps = max(2, min(20, int(dist / 20)))
        for i in range(1, steps + 1):
            t = i / steps
            e = 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2   # ease-in-out
            x = int(frm[0] + (to[0] - frm[0]) * e)
            y = int(frm[1] + (to[1] - frm[1]) * e)
            self.send("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y, button="none", buttons=0)
            time.sleep(random.uniform(0.006, 0.018))

    def click(self, pos, human=True):
        x, y = int(pos[0]), int(pos[1])
        self.send("Input.dispatchMouseEvent", type="mousePressed",
                  x=x, y=y, button="left", buttons=1, clickCount=1)
        time.sleep(random.uniform(0.04, 0.10) if human else 0.012)
        self.send("Input.dispatchMouseEvent", type="mouseReleased",
                  x=x, y=y, button="left", buttons=0, clickCount=1)


# ─────────────────────────────────────────────────────────────────────────────
# jogo
# ─────────────────────────────────────────────────────────────────────────────

JS_STATE = """(() => {
  const mg = JSON.parse(localStorage.getItem('main_game') || 'null');
  if (!mg) return null;
  return JSON.stringify({
    mission: mg.mission,
    values: mg.values.map(v => (v && typeof v.val === 'number') ? v.val : 0),
    editable: mg.values.map(v => !(v && v.editable === false)),
    mistakes: mg.mistakes, hints: mg.hints
  });
})()"""

JS_GEOMETRY = """(() => {
  const cv = document.querySelector('#game canvas');
  if (!cv) return null;
  const r = cv.getBoundingClientRect(), W = cv.width, PAD = 8, CS = (W - 2*PAD) / 9, k = r.width / W;
  const cell = (row, col) => [
    Math.round(r.left + (PAD + (col - 0.5) * CS) * k),
    Math.round(r.top  + (PAD + (row - 0.5) * CS) * k)
  ];
  const cells = {};
  for (let i = 0; i < 81; i++) cells[i] = cell(Math.floor(i / 9) + 1, (i % 9) + 1);
  const numpad = {};
  document.querySelectorAll('.numpad-item').forEach(el => {
    const v = el.getAttribute('data-value');
    if (!v) return;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return;
    numpad[v] = [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)];
  });
  return JSON.stringify({ cells: cells, numpad: numpad, rect: { l: r.left, t: r.top } });
})()"""

JS_PAUSE = """(() => {
  const po = document.querySelector('#pause-overlay');
  if (!po) return null;
  const s = getComputedStyle(po), b = po.getBoundingClientRect();
  if (s.display === 'none' || s.visibility === 'hidden' ||
      parseFloat(s.opacity || '1') <= 0.1 || b.width === 0) return null;
  return JSON.stringify([Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]);
})()"""

JS_CLOSE_OVERLAYS = """(() => {
  let closed = 0, hidden = 0;
  // banner de cookies: clique resolve
  const cc = document.querySelector('.popup-close');
  if (cc) { cc.click(); closed++; }
  // Anuncios e telas que COBREM o tabuleiro. Descoberto na pratica: o
  // `.ima-container` (Google IMA) fica com pointer-events:auto e z-index 99
  // sobre o canvas e engole TODOS os cliques -> os numeros caem na celula
  // errada (3 erros = fim de jogo). Esconder e o unico jeito confiavel.
  for (const sel of ['.ima-container', 'iframe[id*=google_ads]', '[class*=winscreen]',
                     '.vidazoo-float', '.tournament_popup']) {
    document.querySelectorAll(sel).forEach(el => {
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
      hidden++;
    });
  }
  return JSON.stringify({ closed: closed, hidden: hidden });
})()"""

# quem recebe o clique num ponto? (temos que ver CANVAS, não IFRAME/anuncio)
JS_HIT = """(() => {
  const el = document.elementFromPoint(%d, %d);
  return el ? el.tagName + '|' + String(el.className).slice(0, 30) : 'null';
})()"""


def solve(mission):
    """Backtracking puro — devolve lista de 81 ints."""
    b = [int(c) for c in mission]

    def ok(i, v):
        r, c = divmod(i, 9)
        for k in range(9):
            if b[r * 9 + k] == v or b[k * 9 + c] == v:
                return False
        br, bc = (r // 3) * 3, (c // 3) * 3
        for dr in range(3):
            for dc in range(3):
                if b[(br + dr) * 9 + bc + dc] == v:
                    return False
        return True

    def go(i):
        if i == 81:
            return True
        if b[i]:
            return go(i + 1)
        for v in range(1, 10):
            if ok(i, v):
                b[i] = v
                if go(i + 1):
                    return True
                b[i] = 0
        return False

    if not go(0):
        return None
    return b


def hide_ads(page):
    """Esconde anuncios + fecha cookies. CARO (faz o site recarregar ads):
    chamar no inicio e só quando um clique for bloqueado."""
    return page.js(JS_CLOSE_OVERLAYS)


def clear_blockers(page, human=True):
    """Só o que muda sozinho com o tempo: o overlay de pausa. Barato —
    1 avaliação quando não há nada bloqueando."""
    for _ in range(2):
        raw = page.js(JS_PAUSE)
        if not raw:
            return True
        pos = json.loads(raw)
        page.click(pos, human)          # clique direto (sem trajeto: é overlay)
        time.sleep(0.4)
    return False


def main():
    ap = argparse.ArgumentParser(description="Preenche sudoku.com via CDP (input real)")
    ap.add_argument("--check", action="store_true", help="só mostra estado e plano")
    ap.add_argument("--fast", action="store_true", help="sem movimento interpolado")
    ap.add_argument("--max", type=int, default=0, help="limita quantas células preencher")
    args = ap.parse_args()

    t = find_target("sudoku.com")
    if not t:
        sys.exit("não achei aba do sudoku.com no CDP (porta 9222)")

    page = Page(t["webSocketDebuggerUrl"])
    human = not args.fast

    raw = page.js(JS_STATE)
    if not raw:
        sys.exit("o jogo não começou (sem main_game no localStorage) — inicie um nível")
    state = json.loads(raw)
    mission = state["mission"]
    print(f"jogo ativo · erros={state['mistakes']} · dicas={state['hints']}")

    sol = solve(mission)
    if not sol:
        sys.exit("tabuleiro sem solução (leitura errada?)")

    geo = json.loads(page.js(JS_GEOMETRY) or "null")
    if not geo or not geo["numpad"]:
        sys.exit("não achei o canvas/o numpad — a página está no jogo mesmo?")

    vazias = [i for i in range(81) if mission[i] == "0" and not state["values"][i]]
    print(f"vazias a preencher: {len(vazias)}")
    print(f"numpad: {sorted(geo['numpad'])}")

    if args.check:
        for i in vazias[:5]:
            print(f"  idx {i} -> valor {sol[i]} em {geo['cells'][str(i)]}")
        return

    # ── executa ─────────────────────────────────────────────────────────────
    hide_ads(page)                    # uma vez: esconder anuncios e cookies
    clear_blockers(page, human)
    cur = [geo["rect"]["l"] + geo["cells"]["0"][0] * 0 - 120, geo["rect"]["t"] - 30]
    cur = [int(geo["rect"]["l"]) - 120, int(geo["rect"]["t"]) - 30]

    alvo = vazias if not args.max else vazias[: args.max]
    done = 0
    falhas = []
    t0 = time.time()
    for i in alvo:
        pos = geo["cells"][str(i)]

        # confere que o tabuleiro está mesmo recebendo o clique (o anúncio volta!)
        hit = str(page.js(JS_HIT % (pos[0], pos[1])) or "")
        if not hit.startswith("CANVAS"):
            hide_ads(page)
            clear_blockers(page, human)
            hit = str(page.js(JS_HIT % (pos[0], pos[1])) or "")
            if not hit.startswith("CANVAS"):
                falhas.append((i, hit))
                print(f"  ! célula {i} bloqueada por {hit} — pulando")
                continue

        page.move_mouse(cur, pos, human)
        page.click(pos, human)
        cur = pos
        time.sleep(random.uniform(0.12, 0.24) if human else 0.06)

        np = geo["numpad"][str(sol[i])]
        page.move_mouse(cur, np, human)
        page.click(np, human)
        cur = np
        time.sleep(random.uniform(0.14, 0.3) if human else 0.07)

        done += 1
        if done % 8 == 0:
            clear_blockers(page, human)
            _st = page.js(JS_STATE)
            _err = json.loads(_st)["mistakes"] if _st else "jogo terminou?"
            print(f"  ...{done}/{len(alvo)} · erros: {_err}")

    print(f"\n{done} células preenchidas em {time.time() - t0:.1f}s")
    if falhas:
        print(f"células puladas por bloqueio: {len(falhas)} -> {falhas[:5]}")

    raw = page.js(JS_STATE)
    if not raw:
        print("main_game sumiu (o jogo terminou ou reiniciou) — confira a página.")
        return
    st = json.loads(raw)
    esperado = "".join(str(v) for v in sol)
    atual = "".join(str(v) for v in st["values"])
    restantes = sum(1 for i in range(81) if mission[i] == "0" and not st["values"][i])
    print(f"valores = solução? {atual == esperado}")
    print(f"vazias restantes: {restantes} · erros: {st['mistakes']}")


if __name__ == "__main__":
    main()
