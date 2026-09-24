/**
 * G1 Games Helper — Palavras Cruzadas Mini do G1
 *
 * O PUZZLE INTEIRO, COM O GABARITO, VEM DE UM JSON ESTÁTICO DA PRÓPRIA G1:
 *   https://g1.globo.com/jogos/static/cruzada_mini.json
 *   [{ metadata, grid: {width, height, cell: [{x, y, type, solution}]},
 *      word: [{id, x:"2-5", y:"1"}], clues: [{title, clue:[{word,number,format,value}]}] }]
 *
 * Por isso esta extensão NÃO precisa de dicionário nem de LLM: o gabarito chega
 * ao cliente (como o `solution` do sudoku.com no localStorage). O `fetch` é para
 * a mesma origem da página, então não há CORS nem permissão extra.
 *
 * TABULEIRO (SVG, não canvas):
 *   <g class="cell cell-<col>-<row>" transform="translate(col,row)">   ← col/row 0-based
 *     <rect>
 *     <text class="value">B</text>       ← a letra digitada aparece aqui
 *     <text class="number">1</text>      ← número da palavra que começa na célula
 *   </g>
 *
 * PREENCHER = focar a célula (clique) + KeyboardEvent com a letra.
 * Aqui eventos sintéticos FUNCIONAM (é SVG/DOM com handlers Svelte normais) —
 * diferente do sudoku.com, que é canvas e exige input real por CDP.
 */

// Dois jogos, dois gabaritos (mesma estrutura de JSON):
//   /jogos/palavras-cruzadas-mini/  → cruzada_mini.json  (5x5)
//   /jogos/palavras-cruzadas/       → cruzada.json       (grade grande, 20 palavras)
// ⚠️ A regex da página casava com as DUAS (prefixo!) e o cruzadão acabava
// baixando o JSON do mini — gabarito errado. Escolher pela URL, não pela regex.
const CW_URLS = {
  mini: 'https://g1.globo.com/jogos/static/cruzada_mini.json',
  normal: 'https://g1.globo.com/jogos/static/cruzada.json'
};
const CW_PAGE_RE = /g1\.globo\.com\/jogos\/palavras-cruzadas/i;

function cwUrl() {
  return /palavras-cruzadas-mini/i.test(location.pathname) ? CW_URLS.mini : CW_URLS.normal;
}

/** O jogo é o mini (5x5) ou o cruzadão? */
function cwIsMini() {
  return /palavras-cruzadas-mini/i.test(location.pathname);
}

function cwIsPage() {
  return CW_PAGE_RE.test(location.href);
}

/** Tira acentos (o jogo espera A-Z; "ORÓS" entra como "OROS"). */
function cwNorm(letra) {
  return String(letra || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/** Leitura do tabuleiro: células (col,row 0-based) e o que já está preenchido. */
function cwDetect() {
  if (!cwIsPage()) return null;
  const els = [...document.querySelectorAll('g.cell')];
  if (els.length < 4) return null;

  const cells = [];
  for (const el of els) {
    const m = (el.getAttribute('class') || '').match(/cell-(\d+)-(\d+)/);
    if (!m) continue;
    const v = el.querySelector('text.value');
    const num = el.querySelector('text.number');
    cells.push({
      col: +m[1], row: +m[2],
      valor: v ? cwNorm(v.textContent) : '',
      numero: num ? (num.textContent || '').trim() : '',
      el
    });
  }
  if (!cells.length) return null;

  const maxCol = Math.max(...cells.map(c => c.col));
  const maxRow = Math.max(...cells.map(c => c.row));

  // dicas (para relatório e para preencher na ordem em que um humano faria)
  const clues = [];
  for (const bloco of document.querySelectorAll('[class*=clue]')) {
    const t = (bloco.innerText || '').replace(/\s+/g, ' ').trim();
    if (t.length < 4 || t.length > 120) continue;
    clues.push(t);
  }

  return {
    strategy: 'crossword',
    cols: maxCol + 1, rows: maxRow + 1,
    cells,
    preenchidas: cells.filter(c => c.valor).length,
    vazias: cells.filter(c => !c.valor).length,
    clues: clues.slice(0, 20)
  };
}

/** Baixa o JSON do dia e devolve o gabarito por célula + as palavras. */
async function cwLoadAnswer() {
  const r = await fetch(cwUrl(), { cache: 'no-store' });
  if (!r.ok) throw new Error(cwUrl().split('/').pop() + ' → HTTP ' + r.status);
  const data = await r.json();
  const p = Array.isArray(data) ? data[0] : data;

  const sol = {};                       // "col,row" (0-based) -> LETRA
  const blocos = new Set();
  for (const c of (p.grid && p.grid.cell) || []) {
    const key = (Number(c.x) - 1) + ',' + (Number(c.y) - 1);
    if (c.type === 'block') { blocos.add(key); continue; }
    if (c.solution) sol[key] = cwNorm(c.solution);
  }

  // palavras: x/y podem ser faixa ("2-5") ou valor único ("2")
  const palavras = ((p.word) || []).map(w => {
    const parse = s => {
      const t = String(s == null ? '' : s);
      if (t.includes('-')) { const [a, b] = t.split('-').map(Number); return { de: a, ate: b }; }
      const n = Number(t); return { de: n, ate: n };
    };
    const xs = parse(w.x), ys = parse(w.y);
    const horizontal = xs.de > xs.ate ? false : (xs.de !== xs.ate);
    const horizontalCheck = xs.de !== xs.ate;          // x variando = horizontal
    const casas = [];
    if (horizontalCheck) for (let x = xs.de; x <= xs.ate; x++) casas.push({ col: x - 1, row: ys.de - 1 });
    else for (let y = ys.de; y <= ys.ate; y++) casas.push({ col: xs.de - 1, row: y - 1 });
    return { id: w.id, horizontal: horizontalCheck, casas };
  });

  return { sol, blocos, palavras, raw: p };
}

/**
 * Digita uma letra numa célula: foca, clica e manda o keydown/up.
 *
 * ⚠️ A leitura do resultado NÃO pode ser imediata: o framework atualiza o SVG
 * de forma assíncrona, então ler `text.value` na mesma tick volta vazio e TODAS
 * as casas viram "erro" — foi o que aconteceu no cruzadão (ele ficou 74/74
 * preenchido e o relatório dizia `preenchidas: 0`). Aqui esperamos a letra
 * aparecer (poucos ms) antes de julgar.
 */
async function cwTypeInto(cell, letra) {
  const el = cell.el || cell;
  el.focus();
  for (const t of ['mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
  }
  const alvo = (document.activeElement && document.activeElement.closest && document.activeElement.closest('g.cell')) || el;
  const ev = { key: letra, code: 'Key' + letra, bubbles: true, cancelable: true };
  alvo.dispatchEvent(new KeyboardEvent('keydown', ev));
  alvo.dispatchEvent(new KeyboardEvent('keyup', ev));

  const ler = () => {
    const v = el.querySelector('text.value');
    return v ? cwNorm(v.textContent) : '';
  };
  const esperado = cwNorm(letra);
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 70));
    const txt = ler();
    if (txt === esperado) return txt;
  }
  return ler();
}

/**
 * Preenche o quadro. Ordem: palavra por palavra (como um humano), respeitando o
 * modo (humano/normal/rápido).
 */
async function cwFill(answer, opts) {
  const o = opts || {};
  const human = o.human !== false;
  const speed = o.speed || 1;
  const sleepMs = ms => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);

  const tente = cwDetect();
  if (!tente) return { success: false, reason: 'no-crossword' };

  const porCasa = {};
  for (const c of tente.cells) porCasa[c.col + ',' + c.row] = c;

  // monta a lista de casas a preencher, seguindo as palavras quando possível
  const fila = [];
  const jaVistas = new Set();
  const push = (col, row) => {
    const k = col + ',' + row;
    if (jaVistas.has(k)) return;
    jaVistas.add(k);
    const letra = answer.sol[k];
    if (!letra) return;
    const c = porCasa[k];
    if (!c) return;
    if (c.valor === letra) return;      // já está certo
    fila.push({ cell: c, letra, col, row });
  };
  for (const w of answer.palavras) for (const casa of w.casas) push(casa.col, casa.row);
  for (const c of tente.cells) push(c.col, c.row);       // restantes

  let ok = 0, erros = [];
  let palavraAtual = -1, contadorPalavra = 0;
  for (const item of fila) {
    const d = human ? Math.round((180 + Math.random() * 260) / speed) : Math.round(45 / speed);
    await sleepMs(d);
    const lido = await cwTypeInto(item.cell, item.letra);
    if (lido === item.letra) ok++;
    else erros.push({ col: item.col, row: item.row, quer: item.letra, ficou: lido });
    contadorPalavra++;
    // pausa maior entre palavras (~4 letras), como quem pensa na próxima dica
    if (human && contadorPalavra % 4 === 0) await sleepMs(Math.round((450 + Math.random() * 700) / speed));
  }

  return { success: true, preenchidas: ok, total: fila.length, erros, strategy: 'crossword' };
}

/** Extrai o quadro no formato 9x9/矩形 usado pelo popup (para o mini-preview). */
function cwAsGrid(t) {
  const g = [];
  for (let r = 0; r < t.rows; r++) {
    const linha = [];
    for (let c = 0; c < t.cols; c++) {
      const cel = t.cells.find(x => x.col === c && x.row === r);
      linha.push(cel ? (cel.valor || '') : '#');
    }
    g.push(linha);
  }
  return g;
}

/** Elementos clicáveis de verdade (visíveis e no topo), do mais interno ao maior. */
function cwClicaveis() {
  return [...document.querySelectorAll('button, a, div, span')]
    .filter(el => {
      const t = (el.innerText || '').trim();
      if (!t || t.length > 20) return false;
      const b = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (b.width < 10 || b.height < 10) return false;
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.1) return false;
      if (b.top < 0 || b.left < 0 || b.top > innerHeight || b.left > innerWidth) return false;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return hit === el || el.contains(hit) || (hit && hit.contains(el));
    })
    .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
}

/**
 * Garante que o jogo está ABERTO.
 *
 * Descoberto na prática: sem isso a detecção falha porque `g.cell` = 0 — a
 * página mostra "Faça login gratuitamente e aproveite os jogos do g1… Você
 * ainda pode jogar mais 2 partidas sem ter que logar" com os botões
 * **[Mais tarde] [Login]**, e o quadro (`Iniciar`) fica ATRÁS desse modal.
 * O fluxo que funciona: dispensa o modal ("Mais tarde") e clica em "Iniciar".
 */
async function cwEnsureGame(timeoutMs) {
  const limite = timeoutMs || 9000;
  const sleepMs = ms => new Promise(r => setTimeout(r, ms));
  if (document.querySelectorAll('g.cell').length) return true;

  // 1) dispensa o modal de login (se estiver na frente)
  const tarde = cwClicaveis().find(el => (el.innerText || '').trim() === 'Mais tarde');
  if (tarde) { tarde.click(); await sleepMs(500); }

  // 2) clica em "Iniciar" até o tabuleiro aparecer
  const t0 = Date.now();
  while (Date.now() - t0 < limite) {
    if (!document.querySelectorAll('g.cell').length) {
      const btn = cwClicaveis().find(el => (el.innerText || '').trim() === 'Iniciar');
      if (btn) { btn.click(); await sleepMs(700); }
    }
    if (document.querySelectorAll('g.cell').length) return true;
    await sleepMs(400);
  }
  return document.querySelectorAll('g.cell').length > 0;
}

if (typeof window !== 'undefined') {
  window.__g1Crossword = { cwIsPage, cwDetect, cwLoadAnswer, cwFill, cwAsGrid, cwNorm, cwTypeInto, cwEnsureGame };
}
