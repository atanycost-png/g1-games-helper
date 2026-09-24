#!/usr/bin/env python3
"""
Teste de integração do G1 Games Helper — NÃO depende de login no G1.

Abre o fixture local (test/fixture-g1.html), que replica a estrutura do
tabuleiro do G1 (81 DIV.cell com grid-row/column, .cell-btn, .cell-text e um
teclado .btn-key que escreve na célula selecionada), injeta solver.js +
content.js na página e verifica o pipeline completo:

    detectar  ->  resolver  ->  preencher  ->  conferir no DOM

Pré-requisitos:
  - Edge/Chrome com debug remoto:
      msedge.exe --remote-debugging-port=9222 --remote-allow-origins=* \
        --user-data-dir=%LOCALAPPDATA%\\edge-automation-profile about:blank
  - pip install websocket-client

Uso:
  python test/integration_test.py
Exit code 0 = tudo passou.
"""

import json
import pathlib
import sys
import time
import urllib.request

PORT = 9222
ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
FIXTURE = (ROOT / "test" / "fixture-g1.html").as_uri()

# Oráculo: mission (puzzle) e solution (gabarito) reais, vindos da API do sudoku.com.
MISSION = "004300001007091240190040800709200506002050030000076912405080000270000158000625370"
SOLUTION = "524368791867591243193742865749213586612859437358476912435187629276934158981625374"

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  -> " + str(detail)) if detail and not ok else ""))


def http(method, path):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method)
    with urllib.request.urlopen(req, timeout=15) as r:
        body = r.read()
    return json.loads(body) if body else {}


class Page:
    def __init__(self, ws_url):
        import websocket  # noqa: F401  (importado aqui p/ mensagem de erro clara)
        self.ws = websocket.create_connection(ws_url, timeout=180)
        self._id = 0

    def call(self, method, **params):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def js(self, expr, await_promise=True):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True,
                      awaitPromise=await_promise)
        if r.get("exceptionDetails"):
            desc = r["exceptionDetails"].get("exception", {}).get("description")
            raise RuntimeError(f"JS falhou: {desc or r['exceptionDetails']}")
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def main():
    print("integration_test.py\n")

    # 1) Edge com CDP disponível?
    try:
        http("GET", "/json/version")
    except Exception as e:
        print("  FAIL  Edge não está com debug remoto na porta", PORT, "->", e)
        print("\nSuba o Edge com --remote-debugging-port=9222 --remote-allow-origins=*")
        return 1
    check("Edge com CDP acessível", True)

    # 2) Abre o fixture numa aba nova
    tab = http("PUT", "/json/new?" + urllib.parse.quote(FIXTURE, safe=""))
    page = Page(tab["webSocketDebuggerUrl"])
    try:
        # espera as 81 células
        for _ in range(40):
            n = page.js("document.querySelectorAll('DIV.cell').length")
            if n == 81:
                break
            time.sleep(0.25)
        check("fixture carregou com 81 células", n == 81, f"encontrou {n}")

        # 3) Injeta o código REAL da extensão
        solver_src = (EXT / "solver.js").read_text(encoding="utf-8")
        content_src = (EXT / "content.js").read_text(encoding="utf-8")
        page.js("(function(){" + solver_src + "\n" + content_src + "\nreturn 1;})()")
        check("content script injetado e expôs a API",
              page.js("typeof window.__g1Helper === 'object'") is True)

        # 4) Detecção
        det = page.js("""(() => {
            var gd = window.__g1Helper.detectGrid();
            if (!gd) return null;
            var ex = window.__g1Helper.extractGrid(gd);
            return { strategy: gd.strategy, filled: ex.filled, empty: ex.empty, suspect: ex.suspect };
        })()""")
        check("detectou o tabuleiro (estratégia g1)", det and det["strategy"] == "g1", det)
        check("leu 38 fixas / 43 vazias", det and det["filled"] == 38 and det["empty"] == 43, det)
        check("nenhuma célula ambígua (anotação)", det and det["suspect"] == 0, det)

        # 5) Solver (o bug histórico: devolvia a cópia não resolvida)
        got = page.js("""(() => {
            var gd = window.__g1Helper.detectGrid();
            var sol = window.__g1Helper.solutionFor(gd);
            if (!sol) return null;
            return sol.map(function(r){ return r.join(''); }).join('');
        })()""")
        check("solver devolveu o gabarito correto", got == SOLUTION,
              (got or "")[:40] + "...")
        check("solver não devolveu zeros", got is not None and "0" not in got)

        # 6) Preenchimento no DOM
        page.js("""(async () => {
            var gd = window.__g1Helper.detectGrid();
            var sol = window.__g1Helper.solutionFor(gd);
            await window.__g1Helper.fillCells(gd, sol);
            return 1;
        })()""")
        state = page.js("JSON.stringify(window.__checkFixture())")
        st = json.loads(state)
        check("preencheu TODAS as 81 células", st["zeros"] == 0, f"zeros={st['zeros']}")
        check("tabuleiro final == gabarito", st["correto"] is True, st["flat"][:40] + "...")

        # 7) Idempotência: rodar de novo não deve mexer em nada
        again = page.js("""(async () => {
            var gd = window.__g1Helper.detectGrid();
            var sol = window.__g1Helper.solutionFor(gd);
            var res = await window.__g1Helper.fillCells(gd, sol);
            return res.length;
        })()""")
        check("2ª execução não reescreve nada (idempotente)", again == 0, f"reescreveu {again}")
    finally:
        page.close()
        try:
            http("GET", f"/json/close/{tab['id']}")
        except Exception:
            pass

    passed, total = sum(results), len(results)
    print(f"\n{passed}/{total} verificações passaram")
    return 0 if passed == total else 1


if __name__ == "__main__":
    import urllib.parse  # usado em main()
    sys.exit(main())
