/**
 * Teste do solver de sudoku (sem rede, sem browser).
 * Rodar:  node test/solver.test.js
 *
 * Usa um puzzle REAL capturado do sudoku.com (mission) com o gabarito conhecido
 * (solution) — os dois vieram da API do site, então servem como oráculo.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'solver.js'), 'utf8');
const { solveSudoku, validateGrid } =
  new Function('window', src + '\nreturn { solveSudoku, validateGrid };')({});

const mission = '004300001007091240190040800709200506002050030000076912405080000270000158000625370';
const solution = '524368791867591243193742865749213586612859437358476912435187629276934158981625374';

const toGrid = s => Array.from({ length: 9 }, (_, r) => s.slice(r * 9, r * 9 + 9).split('').map(Number));
const flat = g => g.flat().join('');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        -> ' + e.message); fail++; }
}

console.log('solver.test.js\n');

check('validateGrid aceita um gabarito correto', () => {
  assert.strictEqual(validateGrid(toGrid(solution)), true);
});

check('validateGrid rejeita um grid com conflito', () => {
  const g = toGrid(solution);
  g[0][1] = g[0][0];             // duplica na linha 0
  assert.strictEqual(validateGrid(g), false);
});

check('solveSudoku devolve um grid', () => {
  assert.ok(solveSudoku(toGrid(mission)), 'retornou null');
});

check('solveSudoku preenche TODAS as 81 celulas', () => {
  const out = solveSudoku(toGrid(mission));
  const zeros = out.flat().filter(v => v === 0).length;
  assert.strictEqual(zeros, 0,
    'sobraram ' + zeros + ' celulas vazias — classico de devolver a copia NAO resolvida');
});

check('solveSudoku devolve exatamente o gabarito conhecido', () => {
  const out = solveSudoku(toGrid(mission));
  assert.strictEqual(flat(out), solution);
});

check('a solucao devolvida e um grid valido', () => {
  assert.strictEqual(validateGrid(solveSudoku(toGrid(mission))), true);
});

check('nao muta o array de entrada', () => {
  const g = toGrid(mission);
  const before = flat(g);
  solveSudoku(g);
  assert.strictEqual(flat(g), before, 'o grid de entrada foi modificado');
});

check('respeita as celulas dadas (nao troca valores fixos)', () => {
  const out = solveSudoku(toGrid(mission));
  for (let i = 0; i < 81; i++) {
    if (mission[i] !== '0') {
      assert.strictEqual(String(out[Math.floor(i / 9)][i % 9]), mission[i],
        'alterou a celula dada no indice ' + i);
    }
  }
});

console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
