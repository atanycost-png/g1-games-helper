/**
 * Sudoku Solver Engine — backtracking sobre uma CÓPIA do grid.
 *
 * Contrato:
 *   - solveSudoku(grid) -> novo grid 9x9 resolvido, ou null se não houver solução.
 *     NUNCA muta o array recebido (o chamador pode reusar o puzzle lido da página).
 *   - validateGrid(grid) -> true se não há conflito em linha/coluna/bloco.
 *
 * Regressão coberta por test/solver.test.js: uma versão anterior criava a cópia
 * ANTES de resolver e devolvia essa cópia — ou seja, devolvia o puzzle com zeros
 * e ainda mutava a entrada (o bug de "detecta o tabuleiro mas não resolve").
 */

function solveSudoku(grid) {
  // Cópia profunda PRIMEIRO: todo o backtracking acontece aqui.
  const g = grid.map(row => row.slice());

  function isValid(row, col, num) {
    for (let c = 0; c < 9; c++) if (g[row][c] === num) return false;
    for (let r = 0; r < 9; r++) if (g[r][col] === num) return false;
    const br = 3 * Math.floor(row / 3);
    const bc = 3 * Math.floor(col / 3);
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        if (g[r][c] === num) return false;
      }
    }
    return true;
  }

  function solve() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (g[r][c] === 0) {
          for (let num = 1; num <= 9; num++) {
            if (isValid(r, c, num)) {
              g[r][c] = num;
              if (solve()) return true;
              g[r][c] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  return solve() ? g : null;
}

function validateGrid(grid) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] !== 0) {
        const num = grid[r][c];
        grid[r][c] = 0;
        for (let c2 = 0; c2 < 9; c2++) {
          if (c2 !== c && grid[r][c2] === num) { grid[r][c] = num; return false; }
        }
        for (let r2 = 0; r2 < 9; r2++) {
          if (r2 !== r && grid[r2][c] === num) { grid[r][c] = num; return false; }
        }
        const br = 3 * Math.floor(r / 3);
        const bc = 3 * Math.floor(c / 3);
        for (let r2 = br; r2 < br + 3; r2++) {
          for (let c2 = bc; c2 < bc + 3; c2++) {
            if ((r2 !== r || c2 !== c) && grid[r2][c2] === num) { grid[r][c] = num; return false; }
          }
        }
        grid[r][c] = num;
      }
    }
  }
  return true;
}

if (typeof window !== 'undefined') {
  window.SudokuSolver = { solveSudoku, validateGrid };
}
