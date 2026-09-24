#!/usr/bin/env python3
"""
G1 Sudoku Auto-Solver
=====================
Extrai o puzzle do https://g1.globo.com/jogos/sudoku/, resolve com backtracking
e preenche as células automaticamente via CDP (Chrome DevTools Protocol).

Requisitos:
  - msedge.exe com remote-debugging-port=9222
  - Python 3.11+ com browser_use (ou pode rodar manualmente via terminal)

Uso:
  python3 solve_g1_sudoku.py            # Resolve o puzzle atual
  python3 solve_g1_sudoku.py --check   # Só extrai e mostra (não preenche)
  python3 solve_g1_sudoku.py --watch   # Fica monitorando e resolve quando aparecer puzzle
"""

import json
import re
import sys
import time
import argparse
import subprocess
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Configurações
# ──────────────────────────────────────────────────────────────────────────────
CDP_PORT = 9222
G1_SUDOKU_URL = "https://g1.globo.com/jogos/sudoku/"
LOCALAPPDATA = Path.home() / "AppData" / "Local"
EDGE_PROFILE_DIR = LOCALAPPDATA / "edge-automation-profile"
EDGE_PATH = Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")

# ──────────────────────────────────────────────────────────────────────────────
# Utilidades CDP
# ──────────────────────────────────────────────────────────────────────────────
def cdp_eval(js_code: str, timeout: int = 30) -> str:
    """Executa JavaScript na página ativa via CDP Runtime.evaluate."""
    import urllib.request
    import urllib.error
    
    # Pega a primeira página (tab) disponível
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5) as resp:
            tabs = json.loads(resp.read())
    except Exception as e:
        raise RuntimeError(f"CDP não disponível na porta {CDP_PORT}: {e}")
    
    page_tab = None
    for tab in tabs:
        if tab.get("type") == "page":
            page_tab = tab
            break
    
    if not page_tab:
        raise RuntimeError("Nenhuma aba de página encontrada no CDP")
    
    ws_url = page_tab.get("webSocketDebuggerUrl")
    if not ws_url:
        raise RuntimeError("Sem webSocketDebuggerUrl")
    
    # Usa websocket-client se disponível, senão faz via subprocess + curl + ws
    try:
        import websocket
        ws = websocket.create_connection(ws_url, timeout=timeout)
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": js_code, "returnByValue": True}}))
        result = json.loads(ws.recv())
        ws.close()
        if "result" in result and "result" in result["result"]:
            val = result["result"]["result"].get("value", "")
            return str(val) if val is not None else ""
        return ""
    except ImportError:
        # Fallback: usa browser_exec do Hermes se disponível
        return ""

# ──────────────────────────────────────────────────────────────────────────────
# Extrair grid do DOM
# ──────────────────────────────────────────────────────────────────────────────
EXTRACT_JS = r"""
(() => {
  var cells = document.querySelectorAll('DIV.cell');
  if (cells.length === 0) return 'NO_GRID';
  
  var grid = [];
  for (var i = 0; i < cells.length; i++) {
    var style = cells[i].getAttribute('style');
    var match = style.match(/grid-row-start:\s*(\d+).*grid-column-start:\s*(\d+)/s);
    if (!match) continue;
    var row = parseInt(match[1]);
    var col = parseInt(match[2]);
    var spans = cells[i].querySelectorAll('SPAN');
    var value = '';
    for (var s = 0; s < spans.length; s++) {
      var text = spans[s].innerText.trim();
      if (text && /^[1-9]$/.test(text)) {
        value = text;
        break;
      }
    }
    grid.push({r: row, c: col, v: value || '0'});
  }
  
  if (grid.length !== 81) return 'INCOMPLETE:' + grid.length;
  
  var result = [];
  for (var r = 1; r <= 9; r++) {
    var line = [];
    for (var c = 1; c <= 9; c++) {
      var cell = grid.find(g => g.r == r && g.c == c);
      line.push(cell ? cell.v : '0');
    }
    result.push(line.join(''));
  }
  return result.join('|');
})()
"""

def extract_grid():
    """Extrai o grid 9x9 do puzzle. Retorna lista 9x9 com 0=vazio."""
    raw = cdp_eval(EXTRACT_JS)
    if raw == "NO_GRID":
        return None
    if raw.startswith("INCOMPLETE"):
        return None
    
    rows = raw.split("|")
    if len(rows) != 9:
        return None
    
    grid = []
    for row in rows:
        if len(row) != 9:
            return None
        grid.append([int(c) for c in row])
    return grid

# ──────────────────────────────────────────────────────────────────────────────
# Solver (backtracking)
# ──────────────────────────────────────────────────────────────────────────────
def is_valid(grid, row, col, num):
    for c in range(9):
        if grid[row][c] == num:
            return False
    for r in range(9):
        if grid[r][col] == num:
            return False
    br, bc = 3 * (row // 3), 3 * (col // 3)
    for r in range(br, br + 3):
        for c in range(bc, bc + 3):
            if grid[r][c] == num:
                return False
    return True

def solve(grid):
    for r in range(9):
        for c in range(9):
            if grid[r][c] == 0:
                for num in range(1, 10):
                    if is_valid(grid, r, c, num):
                        grid[r][c] = num
                        if solve(grid):
                            return True
                        grid[r][c] = 0
                return False
    return True

# ──────────────────────────────────────────────────────────────────────────────
# Preencher células via CDP
# ──────────────────────────────────────────────────────────────────────────────
FILL_CELL_JS = """
((row, col, val) => {{
  var cells = document.querySelectorAll('DIV.cell');
  for (var i = 0; i < cells.length; i++) {{
    var style = cells[i].getAttribute('style');
    if (style.includes('grid-row-start: ' + row + ';') && style.includes('grid-column-start: ' + col + ';')) {{
      var btn = cells[i].querySelector('.cell-btn');
      if (btn) {{
        btn.click();
        return 'OK';
      }}
    }}
  }}
  return 'NOT_FOUND';
}})({row}, {col}, '{val}')
"""

FILL_NUM_JS = """
((val) => {{
  var btns = document.querySelectorAll('.btn-key');
  for (var i = 0; i < btns.length; i++) {{
    if (btns[i].innerText.trim() === '{val}') {{
      btns[i].click();
      return 'OK';
    }}
  }}
  return 'NOT_FOUND';
}})('{val}')
"""

def fill_cell(row, col, val):
    """Clica na célula (row, col) e depois no botão do número val."""
    r1 = cdp_eval(FILL_CELL_JS.format(row=row, col=col, val=val))
    time.sleep(0.1)
    r2 = cdp_eval(FILL_NUM_JS.format(val=val))
    time.sleep(0.05)
    return r1 == "OK" and r2 == "OK"

# ──────────────────────────────────────────────────────────────────────────────
# Fechar tutorial se estiver aberto
# ──────────────────────────────────────────────────────────────────────────────
CLOSE_TUTORIAL_JS = """
(() => {
  var btns = document.querySelectorAll('BUTTON');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].innerText.trim() === 'Jogar') {
      btns[i].click();
      return 'CLOSED';
    }
  }
  return 'NOT_FOUND';
})()
"""

def close_tutorial():
    return cdp_eval(CLOSE_TUTORIAL_JS)

# ──────────────────────────────────────────────────────────────────────────────
# Verificar se há puzzle na página
# ──────────────────────────────────────────────────────────────────────────────
def is_puzzle_ready():
    raw = cdp_eval(EXTRACT_JS)
    if raw and raw != "NO_GRID" and not raw.startswith("INCOMPLETE"):
        rows = raw.split("|")
        if len(rows) == 9:
            # Verifica se há pelo menos uma célula preenchida
            total = sum(int(c) for row in rows for c in row)
            return total > 0
    return False

# ──────────────────────────────────────────────────────────────────────────────
# Resolver e preencher
# ──────────────────────────────────────────────────────────────────────────────
def solve_and_fill(dry_run=False):
    """Extrai, resolve e preenche o puzzle."""
    
    # Fechar tutorial se necessário
    close_tutorial()
    time.sleep(0.5)
    
    # Extrair grid
    print("📊 Extraindo puzzle...")
    grid = extract_grid()
    
    if grid is None:
        print("❌ Nenhum puzzle encontrado na página.")
        return False
    
    # Mostrar puzzle
    print("\n🧩 Puzzle atual:")
    for r in range(9):
        line = ""
        for c in range(9):
            v = grid[r][c]
            line += str(v) if v != 0 else "."
            if c in [2, 5]:
                line += " │"
            elif c < 8:
                line += " "
        print(f"  {line}")
        if r in [2, 5]:
            print("  ──────┼───────┼──────")
    
    # Contar vazios
    empty_count = sum(1 for r in range(9) for c in range(9) if grid[r][c] == 0)
    print(f"\n🔢 Células vazias: {empty_count}")
    
    if dry_run:
        # Só resolver, não preencher
        import copy
        solution = copy.deepcopy(grid)
        solve(solution)
        print("\n✅ Solução:")
        for r in range(9):
            print("  " + " ".join(str(solution[r][c]) for c in range(9)))
        return True
    
    # Resolver
    print("⏳ Resolvendo...")
    import copy
    solution = copy.deepcopy(grid)
    if not solve(solution):
        print("❌ Sem solução válida!")
        return False
    
    # Preencher
    print("✏️  Preenchendo células...")
    filled = 0
    for r in range(9):
        for c in range(9):
            if grid[r][c] == 0:
                val = solution[r][c]
                if fill_cell(r + 1, c + 1, val):
                    filled += 1
                else:
                    print(f"⚠️  Falha ao preencher ({r+1},{c+1})={val}")
    
    print(f"\n✅ {filled}/{empty_count} células preenchidas!")
    
    # Verificar vitória
    time.sleep(0.5)
    victory = cdp_eval("document.body.innerText.toLowerCase().includes('parab')")
    if victory == "True":
        print("🏆 PARABÉNS! Puzzle resolvido!")
    
    return True

# ──────────────────────────────────────────────────────────────────────────────
# Watch mode — monitora a página e resolve quando aparece puzzle
# ──────────────────────────────────────────────────────────────────────────────
def watch_mode():
    """Monitora a página e resolve automaticamente quando o puzzle aparece."""
    print("👀 Modo watch — monitorando por puzzles...")
    print("   (Ctrl+C para parar)")
    
    while True:
        try:
            if is_puzzle_ready():
                print(f"\n🎯 Puzzle detectado! Resolvendo...")
                solve_and_fill()
                print("\n👀 Continuando monitoramento...")
            time.sleep(2)
        except KeyboardInterrupt:
            print("\n👋 Parando...")
            break
        except Exception as e:
            print(f"⚠️  Erro: {e}")
            time.sleep(5)

# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────
def main():
    global CDP_PORT
    parser = argparse.ArgumentParser(description="G1 Sudoku Auto-Solver")
    parser.add_argument("--check", action="store_true", help="Só extrai e mostra, não preenche")
    parser.add_argument("--watch", action="store_true", help="Fica monitorando por puzzles")
    parser.add_argument("--port", type=int, default=CDP_PORT, help=f"Porta CDP (padrão: {CDP_PORT})")
    args = parser.parse_args()
    
    CDP_PORT = args.port
    
    if args.watch:
        watch_mode()
    else:
        solve_and_fill(dry_run=args.check)

if __name__ == "__main__":
    main()
