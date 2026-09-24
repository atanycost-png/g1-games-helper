// ==UserScript==
// @name         G1 Games Helper
// @namespace    https://github.com/atanycost-png/g1-games-helper
// @version      4.1.0
// @description  Mostra ou resolve Sudoku, Dito, Soletra, Combinado, Caça-Palavras e Cruzadas do G1; no Labirinto mostra o caminho.
// @author       atanycost-png
// @license      MIT
// @homepageURL  https://github.com/atanycost-png/g1-games-helper
// @supportURL   https://github.com/atanycost-png/g1-games-helper/issues
// @icon         https://raw.githubusercontent.com/atanycost-png/g1-games-helper/master/extension/icons/icon128.png
// @match        https://g1.globo.com/jogos/*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==


/* ===========================================================================
 * G1 Games Helper — versão USERSCRIPT
 * ---------------------------------------------------------------------------
 * Este arquivo é GERADO por tools/build_userscript.py a partir dos mesmos
 * módulos usados pela extensão (extension/*.js) — não edite aqui: edite o
 * módulo correspondente e rode o build de novo.
 *
 * Repositório: https://github.com/atanycost-png/g1-games-helper
 * Licença: MIT (c) atanycost-png
 *
 * O que faz: resolve os jogos de lógica e palavras do G1 no seu navegador, com
 * ritmo humanizado e um painel de acompanhamento. Os gabaritos são lidos dos
 * arquivos que o PRÓPRIO site entrega ao navegador (JSONs estáticos e a base
 * embutida do Dito) — nada é enviado para fora e não há servidor.
 * ===========================================================================
 */

(function () {
  'use strict';


/* ---------- solver.js ---------- */

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


/* ---------- crossword.js ---------- */

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


/* ---------- wordsearch.js ---------- */

/**
 * wordsearch.js — Caça-Palavras do G1 (g1.globo.com/jogos/caca-palavras)
 * ======================================================================
 * COMO O JOGO FUNCIONA (tudo descoberto na prática, ver docs/REFERENCIA.md §8):
 *
 *  • A grade é um <svg> com 144 <text> (12x12). Cada célula é um
 *    <g transform="translate(col row)"> com um <text> folha (a letra).
 *    O viewBox é "-0.5 -0.5 12 12" (1 unidade = 1 célula).
 *
 *  • O jogador marca uma palavra ARRASTANDO o mouse (mousedown → mousemove →
 *    mouseup) sobre as células. O handler do jogo lê `event.offsetX/offsetY`
 *    (NÃO clientX/clientY) e calcula:
 *        col = floor(offsetX / (largura * 1.2) * 12)
 *    O `×1.2` compensa o devicePixelRatio do Chrome/Edge.
 *
 *  • É Svelte 5 com EVENT DELEGATION: `Q("mousedown", I, Tt)`, `Q("mousemove",
 *    I, y)`, `Q("mouseup", I, wt)`. Eventos sintéticos (dispatchEvent, inclusive
 *    os do CDP) NÃO acionam a seleção — testado de todas as formas. Por isso
 *    NÃO automatizamos a marcação: DESTACAMOS as respostas na grade e o jogador
 *    marca com o mouse (decisão de projeto: "só deixar as palavras em highlight").
 *
 *  • O GABARITO vem do JSON ESTÁTICO do próprio site — mesma origem, portanto
 *    `fetch` simples, sem CORS, sem permissão extra, sem nada rodando no PC:
 *        https://g1.globo.com/jogos/static/c_palavras.json
 *    { name, description,
 *      content:     ["K D F P R A T I C A S F", ...]   ← 12 linhas de letras
 *      answer:      ["- D - P R A T I C A S -", ...]   ← CAMINHO das palavras
 *      suggestions: ["ORGÃO","BRASIL","REDE",...] }    ← as 7 palavras
 *
 *  A localização de cada palavra cruza as `suggestions` com o `answer`
 *  (só aceita o trecho cujas células estão marcadas) — validado 7/7.
 */

(function () {
  'use strict';

  const WS = {};
  const JSON_URL = '/jogos/static/c_palavras.json';
  const CORES = ['#FFD54F', '#4FC3F7', '#81C784', '#FF8A65', '#BA68C8', '#4DB6AC',
                 '#F06292', '#FFB74D', '#9575CD', '#4DD0E1', '#AED581', '#F48FB1'];
  const HL_CLASS = '__g1ws_hl';
  const LEG_ID = '__g1ws_legenda';
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]];

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /** Normaliza para comparar ("ORGÃO" → "ORGAO"). */
  WS.norm = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().trim();
  };

  WS.isPage = function () {
    return /\/jogos\/caca-palavras/.test(location.pathname) ||
           /\/jogos\/caca-palavras/.test(location.href);
  };

  /** O svg da grade é o único com mais de 100 <text>. */
  WS.findSvg = function () {
    for (const s of document.querySelectorAll('svg')) {
      if (s.querySelectorAll('text').length > 100) return s;
    }
    return null;
  };

  /** O <g> folha da célula (col,row) — o que contém a letra. */
  WS.gDe = function (svg, col, row) {
    for (const g of svg.querySelectorAll('g[transform]')) {
      const m = (g.getAttribute('transform') || '')
        .match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/);
      if (!m) continue;
      if (Number(m[1]) !== col || Number(m[2]) !== row) continue;
      if (g.querySelector('text') && g.querySelectorAll('g').length === 0) return g;
    }
    return null;
  };

  /**
   * Deixa o jogo PRONTO: dispensa o modal de login ("Mais tarde") e clica em
   * "Iniciar". Sem isso o board não existe (0 <text>).
   */
  WS.ensureGame = async function (timeoutMs) {
    const limite = timeoutMs || 9000;
    if (WS.findSvg()) return { ok: true, acao: 'ja-aberto' };

    // CUIDADO: a página lista OUTROS jogos do G1 com links "Jogar" — clicar num
    // deles NAVEGA para outro jogo (aconteceu no teste: fui parar no Soletra).
    // Por isso: só <button> (ou link que aponte para o próprio caça-palavras).
    const clicaPorTexto = re => {
      const cands = [...document.querySelectorAll('button, a')]
        .filter(b => re.test((b.textContent || '').trim()))
        .filter(b => {
          if (b.tagName !== 'A') return true;
          const href = b.getAttribute('href') || '';
          return !href || /caca-palavras/i.test(href);
        });
      const el = cands[0];
      if (el) { el.click(); return (el.textContent || '').trim(); }
      return null;
    };

    const t0 = Date.now();
    let acao = null;
    while (Date.now() - t0 < limite) {
      if (!WS.isPage()) return { ok: false, acao: 'saiu-da-pagina', url: location.pathname };
      if (WS.findSvg()) return { ok: true, acao: acao || 'ja-aberto' };
      if (!acao) {
        const disp = clicaPorTexto(/mais tarde|depois|fechar/i);
        if (disp) { acao = 'dispensou-login'; await sleep(700); continue; }
      }
      const ini = clicaPorTexto(/^\s*(iniciar|começar|jogar)\s*$/i);
      if (ini) { acao = 'iniciou'; await sleep(900); continue; }
      await sleep(400);
    }
    return { ok: !!WS.findSvg(), acao: acao };
  };

  /** Detecção (usada pelo content.js na cadeia de estratégias). */
  WS.detect = function () {
    if (!WS.isPage()) return null;     // nunca confundir com a grade de outro jogo
    const svg = WS.findSvg();
    if (!svg) return null;
    const n = Math.round(Math.sqrt(svg.querySelectorAll('text').length));
    return {
      strategy: 'wordsearch',
      svg: svg,
      celulas: svg.querySelectorAll('text').length,
      grade: n + 'x' + n,
      // compatibilidade com o resto do content.js (não é sudoku)
      cells: []
    };
  };

  /** Busca o gabarito no JSON estático do site (mesma origem). */
  WS.loadPuzzle = async function () {
    const r = await fetch(JSON_URL, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + JSON_URL);
    const puz = await r.json();
    if (!puz || !Array.isArray(puz.content) || !Array.isArray(puz.suggestions)) {
      throw new Error('JSON sem content/suggestions');
    }
    return puz;
  };

  /**
   * Localiza cada palavra na grade cruzando `suggestions` com o `answer`.
   * Devolve [{ palavra, casas: [[col,row], ...], direcao, cor }].
   */
  WS.solve = function (puz) {
    const grade = puz.content.map(l => String(l).trim().split(/\s+/));
    const marc = puz.answer.map(l => String(l).trim().split(/\s+/));
    const N = grade.length;
    const achadas = [];

    for (const palavra of puz.suggestions) {
      const alvo = WS.norm(palavra).replace(/\s+/g, '');
      let achou = null;
      for (let r = 0; r < N && !achou; r++) {
        for (let c = 0; c < N && !achou; c++) {
          for (const d of DIRS) {
            const casas = [];
            let ok = true;
            for (let k = 0; k < alvo.length; k++) {
              const rr = r + d[0] * k, cc = c + d[1] * k;
              if (rr < 0 || cc < 0 || rr >= N || cc >= N) { ok = false; break; }
              if (!marc[rr] || marc[rr][cc] === '-' || marc[rr][cc] == null) { ok = false; break; }
              if (WS.norm(grade[rr][cc]) !== alvo[k]) { ok = false; break; }
              casas.push([cc, rr]);
            }
            if (ok) { achou = casas; break; }
          }
        }
      }
      if (!achou) continue;
      const d = (achou.length > 1)
        ? [achou[1][0] - achou[0][0], achou[1][1] - achou[0][1]]
        : [0, 0];
      const direcao = d[1] === 0 ? 'horizontal' : (d[0] === 0 ? 'vertical' : 'diagonal');
      achadas.push({ palavra: String(palavra), casas: achou, direcao: direcao });
    }

    // ordena do mais longo para o mais curto (as longas são mais difíceis de achar)
    achadas.sort((a, b) => b.casas.length - a.casas.length);
    achadas.forEach((w, i) => { w.cor = CORES[i % CORES.length]; });
    return achadas;
  };

  /** Remove os destaques e a legenda. */
  WS.clear = function () {
    document.querySelectorAll('rect.' + HL_CLASS).forEach(r => r.remove());
    const leg = document.getElementById(LEG_ID);
    if (leg) leg.remove();
  };

  /** Painel flutuante com as palavras e as cores (ajuda a ver o que é o quê). */
  WS.legenda = function (palavras) {
    let leg = document.getElementById(LEG_ID);
    if (!leg) {
      leg = document.createElement('div');
      leg.id = LEG_ID;
      leg.style.cssText = [
        'position:fixed', 'right:14px', 'top:110px', 'z-index:2147483647',
        'background:rgba(20,20,24,.94)', 'color:#fff', 'border-radius:10px',
        'padding:10px 12px', 'font:12px/1.5 system-ui,-apple-system,Segoe UI,sans-serif',
        'box-shadow:0 6px 24px rgba(0,0,0,.45)', 'max-width:220px'
      ].join(';');
      document.body.appendChild(leg);
    }
    leg.innerHTML =
      '<div style="font-weight:700;margin-bottom:6px">Palavras (' + palavras.length + ')</div>' +
      palavras.map(w =>
        '<div style="display:flex;align-items:center;gap:7px;margin:3px 0">' +
        '<span style="width:11px;height:11px;border-radius:3px;background:' + w.cor + ';display:inline-block"></span>' +
        '<span>' + w.palavra + '</span>' +
        '<span style="opacity:.6;font-size:11px">' + w.casas.length + '</span>' +
        '</div>').join('') +
      '<div style="opacity:.6;font-size:11px;margin-top:7px">' +
      'Marque na grade arrastando o mouse.</div>';
  };

  /**
   * Destaca as palavras na grade.
   *  opts.human !== false → destaca uma palavra por vez (dá tempo de acompanhar)
   *  opts.speed           → multiplicador de velocidade no modo humano
   */
  WS.highlight = async function (palavras, opts) {
    opts = opts || {};
    const human = opts.human !== false;
    const speed = opts.speed || 1;

    const svg = WS.findSvg();
    if (!svg) return { ok: false, erro: 'grade nao encontrada' };

    WS.clear();

    let postos = 0;
    const faltou = [];

    const pinta = w => {
      w.casas.forEach(casa => {
        const g = WS.gDe(svg, casa[0], casa[1]);
        if (!g) { faltou.push(casa.join(',')); return; }
        if (g.querySelector('rect.' + HL_CLASS)) return;
        const rc = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rc.setAttribute('x', '-0.45');
        rc.setAttribute('y', '-0.45');
        rc.setAttribute('width', '0.9');
        rc.setAttribute('height', '0.9');
        rc.setAttribute('rx', '0.12');
        rc.setAttribute('fill', w.cor);
        rc.setAttribute('fill-opacity', '0.55');
        rc.setAttribute('class', HL_CLASS);
        rc.setAttribute('pointer-events', 'none');
        g.insertBefore(rc, g.firstChild);   // atrás da letra
        postos++;
      });
    };

    WS.legenda(palavras);

    for (const w of palavras) {
      pinta(w);
      if (human) await sleep(Math.round((420 + Math.random() * 380) / speed));
    }

    return { ok: true, palavras: palavras.length, marcadas: postos, faltou: faltou, svg: svg };
  };

  WS.CORES = CORES;
  window.__g1Wordsearch = WS;

  // Funcoes globais: o content.js chama wsDetect/wsEnsureGame/... direto.
  window.wsIsPage = WS.isPage;
  window.wsDetect = WS.detect;
  window.wsEnsureGame = WS.ensureGame;
  window.wsFindSvg = WS.findSvg;
  window.wsLoadPuzzle = WS.loadPuzzle;
  window.wsSolve = WS.solve;
  window.wsHighlight = WS.highlight;
  window.wsClear = WS.clear;
  if (typeof module !== 'undefined' && module.exports) module.exports = WS;
})();


/* ---------- g1common.js ---------- */

/**
 * g1common.js — base compartilhada dos jogos do G1
 * ================================================
 * Todos os módulos de jogo (dito, soletra, combinado, labirinto, cacapalavras)
 * usam estes helpers e, quando fazem algo, mostram o MESMO painel flutuante
 * ("menu") na página — com o resumo do que foi feito e como acompanhar.
 *
 * Convenções (aprendidas na prática, ver docs/REFERENCIA.md §8 e §9):
 *   • O G1 abre os jogos com um MODAL DE LOGIN → clicar em "Mais tarde".
 *   • Depois do login, o board só existe após clicar em "Iniciar".
 *   • Vários jogos têm TOUR de boas-vindas (`.tour-backdrop`, `.tour-spotlight`)
 *     e/ou drawer "Como jogar" (`.drawer-overlay`) que COBREM o tabuleiro e
 *     engolem cliques → precisam ser fechados antes de qualquer interação.
 *   • NUNCA clicar em `<a>` genérico: a página lista outros jogos com "Jogar" e
 *     isso NAVEGA para fora (já aconteceu de cair no Soletra).
 *   • Emoji/acento: comparar texto sempre normalizado (WS.norm).
 */

(function () {
  'use strict';

  const GC = {};

  // ── utilidades ─────────────────────────────────────────────────────────────

  GC.sleep = ms => new Promise(r => setTimeout(r, ms));

  /** Normaliza texto para comparação: sem acento, sem espaço extra, minúsculo. */
  GC.norm = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  };

  /**
   * Pausa "humana": base aleatória dentro de uma faixa, dividida pela velocidade.
   * human=false → pausa mínima. speed maior = mais rápido.
   */
  GC.delay = function (opts, min, max) {
    const human = !opts || opts.human !== false;
    const speed = (opts && opts.speed) || 1;
    if (!human) return GC.sleep(Math.round(12 / speed));
    const base = min == null ? 90 : min;
    const top = max == null ? 210 : max;
    return GC.sleep(Math.round((base + Math.random() * (top - base)) / speed));
  };

  GC.visivel = function (el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  // ── gates do G1 (login, iniciar, tour) ─────────────────────────────────────

  /** Clica no primeiro botão cujo texto case com `re` (nunca link de outro jogo). */
  GC.clicarPorTexto = function (re, slug) {
    const cands = [...document.querySelectorAll('button, a')]
      .filter(b => GC.visivel(b) && re.test((b.textContent || '').trim()))
      .filter(b => {
        if (b.tagName !== 'A') return true;
        const href = b.getAttribute('href') || '';
        return !!slug && (!href || href.includes(slug));
      });
    if (!cands.length) return null;
    const el = cands[0];
    el.click();
    return (el.textContent || '').trim() || 'ok';
  };

  /** Fecha tour/drawer/pausa que cobrem o tabuleiro. Devolve quantos fechou. */
  GC.fecharBloqueios = async function (vezes) {
    let n = 0;
    for (let i = 0; i < (vezes || 8); i++) {
      const r = (function () {
        // 1) botões de tour/onboarding
        const btn = [...document.querySelectorAll('button')].filter(b => GC.visivel(b) &&
          /^(avançar|avancar|próximo|proximo|entendi|entendido|ok|fechar|pular|começar a jogar|vamos lá|vamos la)$/i
            .test((b.textContent || '').trim()));
        if (btn.length) { btn[0].click(); return (btn[0].textContent || '').trim(); }
        // 2) drawer "Como jogar" aberto sem botão claro
        const ov = document.querySelector('.drawer-overlay');
        if (GC.visivel(ov)) { ov.style.display = 'none'; return 'drawer-escondido'; }
        // 3) overlay de pausa (G1 pausa ao perder foco)
        const pausa = [...document.querySelectorAll('div, section')].find(el => {
          const t = (el.textContent || '').toLowerCase();
          return t.length > 0 && t.length < 250 && /pausad|paused/.test(t) &&
                 el.querySelector('button, [role="button"]');
        });
        if (pausa) { const b = pausa.querySelector('button, [role="button"]'); b.click(); return 'despausei'; }
        return null;
      })();
      if (!r) break;
      n++;
      await GC.sleep(650);
    }
    return n;
  };

  /**
   * Deixa o jogo aberto: fecha bloqueios, dispensa o login e clica em "Iniciar".
   * `pronto()` diz se o board já existe.
   */
  GC.garantirJogo = async function (slug, pronto, opts) {
    const limite = (opts && opts.timeoutMs) || 9000;
    const t0 = Date.now();
    let acao = 'ja-aberto';
    if (pronto()) { await GC.fecharBloqueios(3); return { ok: true, acao: acao }; }
    while (Date.now() - t0 < limite) {
      if (pronto()) { await GC.fecharBloqueios(3); return { ok: true, acao: acao }; }
      acao = GC.clicarPorTexto(/mais tarde|depois|fechar/i) || acao;
      if (acao === 'ja-aberto' || /mais tarde|depois|fechar/i.test(acao)) {
        const i = GC.clicarPorTexto(/^\s*(iniciar|começar|comecar|jogar)\s*$/i, slug);
        if (i) acao = 'iniciou';
      } else {
        const i = GC.clicarPorTexto(/^\s*(iniciar|começar|comecar|jogar)\s*$/i, slug);
        if (i) { acao = 'iniciou'; await GC.sleep(700); continue; }
      }
      await GC.sleep(400);
    }
    await GC.fecharBloqueios(4);
    return { ok: pronto(), acao: acao };
  };

  // ── painel flutuante (o "menu" na página) ──────────────────────────────────

  const PANEL_ID = '__g1g_panel';
  const CORES_JOGO = {
    dito: '#4FC3F7', soletra: '#FFD54F', combinado: '#81C784',
    labirinto: '#FF8A65', cacapalavras: '#BA68C8', cruzadas: '#4DB6AC', sudoku: '#F06292'
  };

  /**
   * Mostra/atualiza o painel. `secoes` = [{ titulo, itens:[{txt, cor?, nota?}], html? }]
   */
  GC.painel = function (titulo, sub, secoes, rodape) {
    let el = document.getElementById(PANEL_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = PANEL_ID;
      el.style.cssText = [
        'position:fixed', 'right:16px', 'top:96px', 'z-index:2147483647',
        'width:264px', 'max-height:72vh', 'overflow:auto',
        'background:rgba(17,17,21,.95)', 'color:#fff', 'border-radius:12px',
        'padding:12px 13px', 'box-shadow:0 10px 34px rgba(0,0,0,.5)',
        'font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif',
        'backdrop-filter:blur(6px)', 'border:1px solid rgba(255,255,255,.10)'
      ].join(';');
      document.body.appendChild(el);
    }
    const cor = CORES_JOGO[titulo.toLowerCase()] || '#4FC3F7';
    const esc = s => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let h = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<span style="width:9px;height:9px;border-radius:50%;background:' + cor + '"></span>' +
      '<b style="flex:1;font-size:13.5px">' + esc(titulo) + '</b>' +
      '<span style="opacity:.65;font-size:11px">G1 Helper</span>' +
      '<button id="__g1g_fechar" style="all:unset;cursor:pointer;opacity:.7;padding:0 3px">✕</button></div>';

    if (sub) h += '<div style="opacity:.78;font-size:12px;margin:-3px 0 9px">' + esc(sub) + '</div>';

    for (const s of (secoes || [])) {
      if (s.titulo) h += '<div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;' +
        'opacity:.55;margin:10px 0 5px">' + esc(s.titulo) + '</div>';
      if (s.html) { h += s.html; continue; }
      for (const it of (s.itens || [])) {
        h += '<div style="display:flex;align-items:center;gap:7px;margin:3px 0">' +
          (it.cor ? '<span style="width:10px;height:10px;border-radius:3px;background:' + it.cor + ';flex:0 0 auto"></span>' : '') +
          '<span style="flex:1">' + esc(it.txt) + '</span>' +
          (it.nota ? '<span style="opacity:.55;font-size:11px">' + esc(it.nota) + '</span>' : '') +
          '</div>';
      }
    }
    if (rodape) h += '<div style="opacity:.55;font-size:11px;margin-top:10px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px">' +
      esc(rodape) + '</div>';

    el.innerHTML = h;
    const x = document.getElementById('__g1g_fechar');
    if (x) x.onclick = GC.painelFechar;
    return el;
  };

  GC.painelFechar = function () {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
  };

  GC.painelStatus = function (texto) {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    let s = el.querySelector('#__g1g_status');
    if (!s) {
      s = document.createElement('div');
      s.id = '__g1g_status';
      s.style.cssText = 'margin-top:9px;font-size:11.5px;opacity:.85;border-top:1px solid rgba(255,255,255,.1);padding-top:7px';
      el.appendChild(s);
    }
    s.textContent = texto;
  };

  // ── teclado ────────────────────────────────────────────────────────────────

  /** Dispara um keydown/keyup "de gente" (com keyCode, que alguns jogos leem). */
  GC.tecla = function (alvo, chave, opts) {
    const so = chave.length === 1 ? chave.toLowerCase() : chave;
    const code = chave.length === 1
      ? 'Key' + chave.toUpperCase()
      : (/^[0-9]$/.test(chave) ? 'Digit' + chave : chave);
    const keyCode = chave.length === 1 ? chave.toUpperCase().charCodeAt(0)
      : (chave === 'Enter' ? 13 : chave === 'Escape' ? 27 : 0);
    const base = Object.assign({
      key: so, code: code, keyCode: keyCode, which: keyCode,
      bubbles: true, cancelable: true, composed: true, view: window
    }, (opts && opts.extra) || {});
    (alvo || document).dispatchEvent(new KeyboardEvent('keydown', base));
    (alvo || document).dispatchEvent(new KeyboardEvent('keyup', Object.assign({}, base, { keyCode: 0, which: 0 })));
  };

  /**
   * ⚠️ Keydown sintético NÃO insere texto em <input>.
   * Jogos que reagem ao `value` (com bind do framework, ex.: Soletra) precisam
   * que o valor seja escrito com o setter nativo + evento `input` — é assim que
   * o Svelte (bind:value) enxerga a mudança.
   */
  GC.setValor = function (inp, texto) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, String(texto));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /** Digita uma palavra letra a letra, com pausa humana entre as letras. */
  GC.digitar = async function (alvo, palavra, opts) {
    for (const c of String(palavra)) {
      GC.tecla(alvo, c);
      await GC.delay(opts, 70, 190);
    }
  };

  /** Clique real (mouse completo) num elemento — mais compatível que .click(). */
  GC.cliqueReal = function (el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const mk = (t, b) => new MouseEvent(t, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: b
    });
    ['pointerdown', 'mousedown'].forEach(t => el.dispatchEvent(mk(t, 1)));
    ['pointerup', 'mouseup', 'click'].forEach(t => el.dispatchEvent(mk(t, 0)));
  };

  window.__g1g = GC;
  window.gcSleep = GC.sleep;
  window.gcNorm = GC.norm;
  window.gcDelay = GC.delay;
  window.gcFecharBloqueios = GC.fecharBloqueios;
  window.gcGarantirJogo = GC.garantirJogo;
  window.gcPainel = GC.painel;
  window.gcPainelStatus = GC.painelStatus;
  window.gcPainelFechar = GC.painelFechar;
  window.gcTecla = GC.tecla;
  window.gcDigitar = GC.digitar;
  window.gcSetValor = GC.setValor;
  window.gcCliqueReal = GC.cliqueReal;
  window.gcCores = CORES_JOGO;
})();


/* ---------- dito.js ---------- */

/**
 * dito.js — Dito (g1.globo.com/jogos/dito)
 * ========================================
 * Jogo tipo Wordle: 6 tentativas para a palavra secreta de 5 letras.
 *
 * A RESPOSTA NÃO vem de rede: o cliente já carrega a base do dia embutida em um
 * chunk (`.../index.<hash>.js`) na forma
 *     JSON.parse('[{"id":91186103511,"date":1691982000000,"value":"sinal"}, ...]')
 * com ~1236 entradas diárias (cobre o ano inteiro). Lemos o chunk, achamos a
 * entrada cuja data local é HOJE e digitamos. Nada roda na máquina do usuário.
 *
 * Validação: em 2026-09-23 a base deu "moeda"; um chute "TERRA" na página marcou
 * apenas o A final como correto — consistente.
 *
 * O tabuleiro é DOM puro (`.board .row`, `.letter` com classes
 * correct / not-ordered / wrong) e o teclado é de <button class="key">.
 */

(function () {
  'use strict';

  const D = {};
  const SLUG = 'dito';
  const CACHE_URL = '__g1g_dito_chunk';

  D.isPage = () => /\/jogos\/dito/.test(location.pathname);

  /** O tabuleiro existe? (6 linhas de 5 letras) */
  D.pronto = function () {
    return document.querySelectorAll('.board .row').length >= 6;
  };

  D.detect = function () {
    if (!D.isPage()) return null;
    const linhas = document.querySelectorAll('.board .row').length;
    if (!linhas) return null;
    return { game: 'dito', linhas: linhas, letras: 5 };
  };

  // ── a base de palavras do próprio site ─────────────────────────────────────

  async function carregarBase() {
    const cache = (() => { try { return sessionStorage.getItem(CACHE_URL); } catch (e) { return null; } })();
    const urls = [...performance.getEntriesByType('resource')].map(r => r.name)
      .filter(u => new RegExp('/jogos/_astro/.*\\.js').test(u))
      .filter(u => !/ads|doubleclick|google|prebid|taboola|criteo|permutive|chartbeat|liadm|rubicon|amazon/i.test(u));
    const ordem = cache ? [cache, ...urls.filter(u => u !== cache)] : urls;

    for (const u of ordem) {
      try {
        const t = await (await fetch(u, { cache: 'no-store' })).text();
        const m = t.match(/JSON\.parse\('(\[\{"id":\d+,"date":\d+,"value":"[^"]+"\}[\s\S]*?\])'\)/);
        if (!m) continue;
        const lista = JSON.parse(m[1].replace(/\\'/g, "'"));
        if (!Array.isArray(lista) || !lista.length) continue;
        try { sessionStorage.setItem(CACHE_URL, u); } catch (e) {}
        return lista;
      } catch (e) { /* chunk indisponível */ }
    }
    return null;
  }

  const chaveDia = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();

  /** { palavra, data, total } da entrada de hoje. */
  D.palavraDeHoje = async function () {
    const lista = await carregarBase();
    if (!lista) return { erro: 'base de palavras não encontrada nos chunks do site' };
    const hoje = chaveDia(new Date());
    const item = lista.find(x => chaveDia(new Date(x.date)) === hoje);
    if (!item) return { erro: 'sem entrada para hoje (' + hoje + ') na base' };
    return { palavra: String(item.value).toUpperCase(), data: hoje, total: lista.length };
  };

  // ── leitura do estado na tela ──────────────────────────────────────────────

  /**
   * Leitura do tabuleiro.
   *
   * ⚠️ `palavraDoDia` NÃO é opcional na prática: o jogo guarda a sessão em
   * localStorage e, no dia seguinte, pode restaurar no DOM o tabuleiro vencedor
   * de ONTEM. Sem comparar com a palavra de hoje o robô responde "já estava
   * resolvido hoje" e PULA o desafio novo — aconteceu na virada do dia 23→24.
   */
  D.estado = function (palavraDoDia) {
    const linhas = [...document.querySelectorAll('.board .row')].map(r => ({
      texto: (r.textContent || '').trim(),
      cls: [...r.children].map(c => String(c.className).replace(/svelte-\S+/g, '').trim())
    }));
    const usadas = linhas.filter(l => l.texto).length;
    const vencedora = linhas.find(l => l.cls.length && l.cls.every(c => /correct/.test(c)));
    const mesmaPalavra = !palavraDoDia || !vencedora ||
      window.gcNorm(vencedora.texto) === window.gcNorm(palavraDoDia);
    const tela = document.body.innerText.replace(/\s+/g, ' ');
    return {
      linhas: linhas.slice(0, usadas),
      tentativasUsadas: usadas,
      linhaVencedora: vencedora ? vencedora.texto : null,
      acertou: !!vencedora && mesmaPalavra,
      acertouOntem: !!vencedora && !mesmaPalavra,
      tela: tela.slice(0, 200)
    };
  };

  // ── jogar ──────────────────────────────────────────────────────────────────

  /** Clica a tecla do teclado virtual; cai para keydown se não achar o botão. */
  async function teclar(letra, tecladoEsperando, opts) {
    const alvo = letra.toUpperCase();
    const btn = [...document.querySelectorAll('button.key')]
      .find(b => (b.textContent || '').trim().toUpperCase() === alvo);
    if (btn) { window.gcCliqueReal(btn); }
    else { window.gcTecla(document, alvo.toLowerCase()); }
    await window.gcDelay(opts, 90, 200);
  }

  /**
   * Resolve o Dito: digita a palavra do dia e confirma.
   * opts.human !== false → pausas de gente entre letras e antes do ENTER.
   */
  D.solve = async function (opts) {
    opts = opts || {};
    await window.gcFecharBloqueios(4);

    if (!D.pronto()) {
      await window.gcGarantirJogo(SLUG, D.pronto, { timeoutMs: 9000 });
    }
    if (!D.pronto()) return { ok: false, erro: 'tabuleiro do Dito não apareceu' };

    // a resposta do dia vem primeiro: é ela que decide se o tabuleiro na tela é
    // de hoje ou o resto da partida de ontem
    const r = await D.palavraDeHoje();
    if (r.erro) {
      window.gcPainel('Dito', 'Não consegui ler o gabarito', [
        { titulo: 'Motivo', itens: [{ txt: r.erro }] }
      ], 'Recarregue a página (F5) e tente de novo.');
      return { ok: false, erro: r.erro };
    }

    const st = D.estado(r.palavra);
    if (st.acertou) {
      window.gcPainel('Dito', 'Partida de hoje já resolvida', [
        { titulo: 'Situação', itens: [
          { txt: 'A palavra de hoje (' + r.palavra + ') já está na tela', nota: st.tentativasUsadas + '/6' }
        ] }
      ], 'Aguarde o próximo desafio (à meia-noite).');
      return { ok: true, jaResolvido: true, palavra: r.palavra };
    }
    if (st.acertouOntem) {
      // o DOM ainda mostra a vitória do dia anterior — não é "já resolvido hoje"
      window.gcPainelStatus('tabuleiro de ontem na tela (' + st.linhaVencedora + ') — jogando o de hoje');
    }

    window.gcPainel('Dito', 'Palavra do dia: ' + r.palavra, [
      { titulo: 'Como o robô joga', itens: [
        { txt: 'Digita a palavra letra a letra', nota: 'modo ' + (opts.human === false ? 'rápido' : 'humano') },
        { txt: 'Confirma com ENTER', nota: '1 tentativa' }
      ] },
      { titulo: 'Base do site', itens: [{ txt: r.total + ' palavras diárias', nota: r.data }] }
    ], 'A resposta vem do próprio site — nada roda no seu PC.');

    window.gcPainelStatus('digitando…');
    for (const c of r.palavra) await teclar(c, true, opts);

    if (opts.human !== false) await window.gcSleep(Math.round(320 / ((opts && opts.speed) || 1)));

    window.gcPainelStatus('confirmando…');
    const ent = [...document.querySelectorAll('button.key')]
      .find(b => /enter/i.test((b.textContent || '').trim()));
    if (ent) window.gcCliqueReal(ent);
    else window.gcTecla(document, 'Enter');

    // a animação de "flip" das letras leva ~1s: ler uma vez só às vezes pega o
    // tabuleiro ainda virando e o painel anuncia "tentativa enviada" no lugar de
    // "acertou". Aqui espera a confirmação aparecer (até ~4s).
    let fim = D.estado(r.palavra);
    for (let i = 0; i < 6 && !fim.acertou; i++) {
      await window.gcSleep(650);
      fim = D.estado(r.palavra);
      if (fim.acertou) break;
    }

    window.gcPainel('Dito', fim.acertou ? 'Acertou: ' + r.palavra : 'Tentativa enviada: ' + r.palavra, [
      { titulo: 'Situação', itens: [
        { txt: fim.acertou ? 'Palavra confirmada na tela' : 'Confira o resultado na tela', nota: 'tentativas: ' + fim.tentativasUsadas + '/6' }
      ] }
    ], fim.acertou ? 'Parabéns! O próximo desafio sai à meia-noite.' : 'Se não fechou, clique em Detectar de novo.');

    return { ok: true, palavra: r.palavra, acertou: fim.acertou, tentativas: fim.tentativasUsadas };
  };

  D.panelData = async function () {
    const r = await D.palavraDeHoje();
    return r.erro ? null : { titulo: 'Dito', sub: 'palavra de hoje', itens: [r.palavra] };
  };

  window.__g1Dito = D;
  window.ditoIsPage = D.isPage;
  window.ditoDetect = D.detect;
  window.ditoSolve = D.solve;
  window.ditoEstado = D.estado;
})();


/* ---------- soletra.js ---------- */

/**
 * soletra.js — Soletra (g1.globo.com/jogos/soletra)
 * =================================================
 * Jogo tipo "Spelling Bee": 7 letras, formar o máximo de palavras (as que usam
 * TODAS as letras valem como *pangrama* e pontuam mais).
 *
 * O GABARITO vem do JSON estático do próprio site (mesma origem, sem CORS):
 *   https://g1.globo.com/jogos/static/soletra.json
 *     { letters:"zaimort", word_count:29, total_score:210, pangram_count:6,
 *       pangram_list:[...], word_list:[{word,score,pangram,label}, ...] }
 *
 * COMO PREENCHER (validado): não adianta setar `input.value` — o jogo mantém o
 * estado pelas TECLAS. É preciso focar o `#input` e disparar keydown/keyup por
 * letra, depois ENTER (ou o botão "Confirmar"). Uma palavra "amortizar" digitada
 * assim rendeu "Encontrou uma palavra 'pangrama'! +16 pontos" e 1/29.
 */

(function () {
  'use strict';

  const S = {};
  const SLUG = 'soletra';
  const JSON_URL = '/jogos/static/soletra.json';

  S.isPage = () => /\/jogos\/soletra/.test(location.pathname);

  S.pronto = () => !!document.querySelector('#input') && !!document.querySelector('.letters');

  S.contador = function () {
    const m = document.body.innerText.match(/já encontradas\s*(\d+)\s*\/\s*(\d+)/i);
    return m ? { achadas: Number(m[1]), total: Number(m[2]) } : null;
  };

  S.detect = function () {
    if (!S.isPage() || !S.pronto()) return null;
    const letras = [...document.querySelectorAll('.letters svg, .letters text')]
      .map(e => (e.textContent || '').trim().toUpperCase()).filter(t => /^[A-Z]$/.test(t));
    const c = S.contador();
    return {
      game: 'soletra',
      letras: [...new Set(letras)].join(' '),
      achadas: c ? c.achadas : null,
      total: c ? c.total : null
    };
  };

  S.loadPuzzle = async function () {
    const r = await fetch(JSON_URL, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + JSON_URL);
    const p = await r.json();
    if (!p || !Array.isArray(p.word_list)) throw new Error('JSON sem word_list');
    return p;
  };

  /** Ordem "de gente": curtas antes, pangramas por último (o momento uau). */
  S.ordem = function (puz) {
    return puz.word_list.slice().sort((a, b) => {
      if (!!a.pangram !== !!b.pangram) return a.pangram ? 1 : -1;
      if (a.word.length !== b.word.length) return a.word.length - b.word.length;
      return a.word.localeCompare(b.word, 'pt-BR');
    });
  };

  /**
   * Digita uma palavra e confirma.
   *
   * ⚠️ DOIS detalhes que custaram um teste inteiro (29 palavras rejeitadas):
   *  1. `keydown` sintético NÃO escreve no <input>: quem alimenta o jogo é o
   *     `value` (o componente usa `bind:value`), então escrevemos o valor
   *     acumulado com `gcSetValor` e só mandamos o keydown para o jogo "sentir"
   *     a digitação (e para sair do estado `firstLoad`).
   *  2. Enquanto `firstLoad` for true o ENTER é ignorado — e quem desliga é a
   *     função `B()`, chamada justamente no keydown de uma letra qualquer. Por
   *     isso a ordem certa é: keydown → escreve o valor → ENTER.
   */
  S.digitarPalavra = async function (palavra, opts) {
    const inp = document.querySelector('#input');
    if (!inp) return false;
    // ⚠️ Se o input não estiver focado, o ENTER pode acionar o botão focado da
    // página — e "Encerrar partida" ENCERRA a partida. Garante o foco.
    for (let i = 0; i < 3 && document.activeElement !== inp; i++) {
      inp.focus();
      await window.gcSleep(80);
    }
    const human = !opts || opts.human !== false;

    if (human) {
      let acc = '';
      for (const c of String(palavra)) {
        window.gcTecla(inp, c);            // 1º keydown limpa o firstLoad
        acc += c;
        window.gcSetValor(inp, acc);
        await window.gcDelay(opts, 80, 190);
      }
    } else {
      window.gcTecla(inp, String(palavra)[0] || 'a');
      window.gcSetValor(inp, palavra);
    }

    await window.gcDelay(opts, 90, 180);
    window.gcTecla(inp, 'Enter');
    return true;
  };

  async function painelLista(puz, feitas, status) {
    const itens = puz.word_list.map(w => ({
      txt: w.word + (w.pangram ? ' ★' : ''),
      nota: w.score + 'p' + (feitas.has(w.word) ? ' ✔' : '')
    }));
    window.gcPainel('Soletra',
      'Letras: ' + puz.letters.toUpperCase().split('').join(' ') +
      '  ·  ' + puz.word_count + ' palavras (' + puz.pangram_count + ' pangramas)',
      [
        { titulo: 'Palavras (' + feitas.size + '/' + puz.word_count + ')', itens: itens },
        { titulo: 'Pontuação', itens: [{ txt: 'total possível', nota: puz.total_score + ' pts' }] }
      ],
      status || '★ = pangrama (usa as 7 letras). A pontuação vem do site.');
  }

  /**
   * Resolve o Soletra: digita todas as palavras da lista do site.
   * opts.soPangramas → só as pangramas (bem mais rápido/“humano”)
   * opts.limite       → máximo de palavras nesta rodada
   */
  S.solve = async function (opts) {
    opts = opts || {};
    await window.gcFecharBloqueios(4);
    if (!S.pronto()) await window.gcGarantirJogo(SLUG, S.pronto, { timeoutMs: 9000 });
    if (!S.pronto()) return { ok: false, erro: 'soletra não abriu (input ausente)' };

    let puz;
    try { puz = await S.loadPuzzle(); }
    catch (e) {
      return { ok: false, erro: 'sem o JSON do site: ' + String(e.message || e) };
    }

    const lista = opts.soPangramas
      ? S.ordem(puz).filter(w => w.pangram)
      : S.ordem(puz);
    const alvo = opts.limite ? lista.slice(0, opts.limite) : lista;

    const antes = S.contador() || { achadas: 0 };
    const feitas = new Set();
    let pontos = 0;
    let placar = antes.achadas;          // placar lido a cada palavra
    const falhas = [];

    await painelLista(puz, feitas, 'começando… o jogo aceita as palavras na hora.');

    for (let i = 0; i < alvo.length; i++) {
      const w = alvo[i];
      window.gcPainelStatus('digitando ' + (i + 1) + '/' + alvo.length + ': ' + w.word);
      await S.digitarPalavra(w.word, opts);
      await window.gcSleep(Math.round(420 / ((opts && opts.speed) || 1)));

      // o jogo conta sozinho: se o placar subiu, a palavra foi aceita
      const c = S.contador();
      const agora = c ? c.achadas : placar;
      if (agora > placar) {
        feitas.add(w.word); pontos += w.score; placar = agora;
      } else {
        falhas.push(w.word);
      }
      if (i % 4 === 3) await window.gcSleep(Math.round(260 / ((opts && opts.speed) || 1)));
    }

    const fim = S.contador() || { achadas: 0, total: puz.word_count };
    await painelLista(puz, feitas,
      'Digitadas ' + alvo.length + ' palavras · placar do jogo: ' + fim.achadas + '/' +
      (fim.total || puz.word_count) + ' · ~' + pontos + ' pts');

    return {
      ok: true, game: 'soletra', letras: puz.letters,
      tentadas: alvo.length, confirmadas: feitas.size,
      rejeitadas: falhas.length ? falhas.join(' ') : null,
      placar: fim.achadas + '/' + (fim.total || puz.word_count),
      pontosAprox: pontos
    };
  };

  window.__g1Soletra = S;
  window.soletraIsPage = S.isPage;
  window.soletraDetect = S.detect;
  window.soletraSolve = S.solve;
  window.soletraPuzzle = S.loadPuzzle;
})();


/* ---------- combinado.js ---------- */

/**
 * combinado.js — Combinado (g1.globo.com/jogos/combinado)
 * ======================================================
 * Jogo tipo "Connections": 16 palavras embaralhadas formam 4 grupos de 4.
 *
 * O GABARITO vem do JSON estático do site (mesma origem):
 *   https://g1.globo.com/jogos/static/combinado.json
 *     { words:[16 palavras], groups:[4 nomes de grupo], order:[16 índices] }
 *
 * Estrutura (validada): `words` está em BLOCOS DE 4 já na ordem dos grupos —
 *   words[0..3]   → groups[0]
 *   words[4..7]   → groups[1]   ...
 * e `order` mapeia a POSIÇÃO na tela → índice em `words`
 *   tela[i] = words[order[i]]
 * (confira: order=[1,8,13,5,...] → tela[0]=words[1]='propósito',
 *  tela[1]=words[8]='valente', … bateu com o DOM, 16/16).
 *
 * Algumas palavras vêm com "\r" no fim (quirk do JSON) — normalizar sempre.
 *
 * PREENCHER: as palavras são <button class="cell">; basta clicar nas 4 do grupo
 * e em "Confirmar". Validado: o slot "Grupo 1" virou "G1" e o jogo avançou para
 * o "Grupo 2".
 */

(function () {
  'use strict';

  const C = {};
  const SLUG = 'combinado';
  const JSON_URL = '/jogos/static/combinado.json';

  C.isPage = () => /\/jogos\/combinado/.test(location.pathname);
  C.celulas = () => [...document.querySelectorAll('button.cell')];
  C.pronto = () => C.celulas().length >= 16;

  /** Slots dos grupos: "Grupo N" (a resolver) ou "GN" (resolvido). */
  C.slots = function () {
    return [...document.querySelectorAll('button')]
      .map(b => (b.textContent || '').trim())
      .filter(t => /^(grupo\s*\d|g\d)$/i.test(t));
  };

  C.resolvidos = function () {
    return C.slots().filter(t => /^g\d$/i.test(t)).length;
  };

  C.detect = function () {
    if (!C.isPage() || !C.pronto()) return null;
    return {
      game: 'combinado',
      palavras: C.celulas().length,
      gruposResolvidos: C.resolvidos()
    };
  };

  C.loadPuzzle = async function () {
    const r = await fetch(JSON_URL, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + JSON_URL);
    const p = await r.json();
    if (!p || !Array.isArray(p.words) || !Array.isArray(p.groups)) throw new Error('JSON sem words/groups');
    return p;
  };

  /** [{ nome, palavras:[4] }] — os blocos de 4 do JSON. */
  C.grupos = function (puz) {
    const limpo = puz.words.map(w => String(w).replace(/[\r\n\t]/g, '').trim());
    return puz.groups.map((nome, i) => ({
      nome: String(nome),
      palavras: limpo.slice(i * 4, i * 4 + 4)
    }));
  };

  async function acharCelula(palavra) {
    const alvo = window.gcNorm(palavra);
    return C.celulas().find(c => window.gcNorm(c.textContent) === alvo) || null;
  }

  async function painelGrupos(puz, feitos, status) {
    const cores = ['#81C784', '#4FC3F7', '#FFD54F', '#F06292'];
    const grupos = C.grupos(puz);
    const secoes = grupos.map((g, i) => ({
      titulo: g.nome + (feitos.has(i) ? '  ✔' : ''),
      itens: g.palavras.map(p => ({ txt: p, cor: feitos.has(i) ? cores[i % 4] : null }))
    }));
    window.gcPainel('Combinado', 'Grupos resolvidos: ' + feitos.size + '/' + grupos.length,
      secoes, status || 'Cada grupo tem 4 palavras do mesmo tema.');
  }

  /**
   * Resolve o Combinado: clica as 4 palavras de cada grupo e confirma.
   * opts.grupo → resolve só um grupo (0..3).
   */
  C.solve = async function (opts) {
    opts = opts || {};
    await window.gcFecharBloqueios(4);
    if (!C.pronto()) await window.gcGarantirJogo(SLUG, C.pronto, { timeoutMs: 9000 });
    if (!C.pronto()) return { ok: false, erro: 'tabuleiro do Combinado não apareceu' };

    let puz;
    try { puz = await C.loadPuzzle(); }
    catch (e) { return { ok: false, erro: 'sem o JSON do site: ' + String(e.message || e) }; }

    const grupos = C.grupos(puz);
    const feitos = new Set();
    const detalhes = [];
    const alvos = (opts.grupo != null) ? [Number(opts.grupo)] : [0, 1, 2, 3];

    await painelGrupos(puz, feitos, 'começando…');

    for (const gi of alvos) {
      const g = grupos[gi];
      if (!g) continue;
      window.gcPainelStatus('grupo ' + (gi + 1) + ': ' + g.nome);

      // limpa seleção anterior, se houver
      const limpar = [...document.querySelectorAll('button')].find(b => /^\s*limpar\s*$/i.test((b.textContent || '').trim()));
      if (limpar) { limpar.click(); await window.gcSleep(260); }

      const clicadas = [];
      for (const p of g.palavras) {
        const cel = await acharCelula(p);
        if (!cel) continue;
        window.gcCliqueReal(cel);
        clicadas.push(p);
        await window.gcDelay(opts, 140, 330);
      }
      if (clicadas.length < 4) {
        detalhes.push({ grupo: g.nome, erro: 'só achei ' + clicadas.length + '/4 na tela' });
        continue;
      }

      await window.gcDelay(opts, 220, 420);
      const conf = [...document.querySelectorAll('button')].find(b => /^\s*confirmar\s*$/i.test((b.textContent || '').trim()));
      if (!conf) { detalhes.push({ grupo: g.nome, erro: 'sem botão Confirmar' }); continue; }
      window.gcCliqueReal(conf);

      // confirma pelo slot: "Grupo N" → "GN"
      let ok = false;
      for (let t = 0; t < 12; t++) {
        await window.gcSleep(320);
        if (C.resolvidos() > feitos.size) { ok = true; break; }
      }
      if (ok) feitos.add(gi);
      detalhes.push({ grupo: g.nome, palavras: g.palavras, ok: ok });
      await painelGrupos(puz, feitos, ok ? 'grupo "' + g.nome + '" aceito' : 'grupo "' + g.nome + '" não confirmou');
      await window.gcDelay(opts, 320, 620);
    }

    const tela = document.body.innerText.replace(/\s+/g, ' ');
    const venceu = /parabéns|acertou todos|completou|zerou/i.test(tela);
    await painelGrupos(puz, feitos,
      'Grupos: ' + C.resolvidos() + '/4' + (venceu ? ' · jogo concluído!' : ''));

    return {
      ok: feitos.size > 0, game: 'combinado',
      gruposResolvidos: C.resolvidos(), tentados: alvos.length,
      detalhes: detalhes, venceu: venceu
    };
  };

  window.__g1Combinado = C;
  window.combinadoIsPage = C.isPage;
  window.combinadoDetect = C.detect;
  window.combinadoSolve = C.solve;
  window.combinadoPuzzle = C.loadPuzzle;
})();


/* ---------- labirinto.js ---------- */

/**
 * labirinto.js — Labirinto (g1.globo.com/jogos/labirinto)
 * ======================================================
 * Descobrir a palavra do dia ligando as letras na ordem certa; é preciso passar
 * por TODAS as casas do tabuleiro (grade 7x7 = 49 casas).
 *
 * O CAMINHO COMPLETO vem no JSON estático do site (mesma origem):
 *   https://g1.globo.com/jogos/static/labirinto.json
 *     { word:"EDIFICAR", clue:"Ato de construir algo do zero",
 *       rows:7, cols:7,
 *       letter_positions:[[col,row,"E"], ...],      ← ORDEM DA PALAVRA
 *       solution_path:[[col,row], ...],             ← 49 casas, o trajeto inteiro
 *       walls:[[[col,row],[col,row]], ...] }
 *
 * ⚠️ ARMADILHA: as coordenadas são **[col, row]**, não [row, col]. O próprio jogo
 * calcula `Qt(x,y,...) → [floor(x/cel), floor(y/cel)]`. Transpor faz o traço sair
 * torto e o jogo coleta letras fora de ordem (aconteceu: veio "ERIA" em vez de
 * "EDIFICAR").
 *
 * ⚠️ BLOQUEIOS: além do modal de login, o Labirinto abre com TOUR
 * (`.tour-backdrop`/`.tour-spotlight` com "Avançar"/"Fechar") e drawer
 * "Como jogar" — os dois COBREM o canvas e engolem o arrasto. Fechar primeiro.
 *
 * ENTRADA: o jogo é um <canvas> com listeners de mousedown/mousemove/mouseup
 * lendo clientX/clientY, célula = floor(canvasSize / gridSize) em CSS px
 * (canvas 336 CSS px, 48 px por casa). Arrastar do início passando casa a casa
 * funciona: validado com Input.dispatchMouseEvent (mouse real) → "EDIFICAR"
 * completo → "Parabéns! Mestre do labirinto!".
 */

(function () {
  'use strict';

  const L = {};
  const SLUG = 'labirinto';
  const JSON_URL = '/jogos/static/labirinto.json';

  L.isPage = () => /\/jogos\/labirinto/.test(location.pathname);

  L.canvas = () => document.querySelector('.labirinto-canvas__canvas');
  L.pronto = () => !!L.canvas() && L.canvas().getBoundingClientRect().width > 0;

  L.display = function () {
    const w = document.querySelector('.word-display');
    return w ? (w.textContent || '').replace(/\s+/g, ' ').trim() : '';
  };

  L.detect = function () {
    if (!L.isPage() || !L.pronto()) return null;
    const cv = L.canvas();
    return {
      game: 'labirinto',
      canvas: { w: Math.round(cv.getBoundingClientRect().width), h: Math.round(cv.getBoundingClientRect().height) },
      display: L.display()
    };
  };

  L.loadPuzzle = async function () {
    const r = await fetch(JSON_URL, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + JSON_URL);
    const p = await r.json();
    if (!p || !Array.isArray(p.solution_path)) throw new Error('JSON sem solution_path');
    return p;
  };

  /** Direções legíveis do caminho (← ↑ → ↓) para mostrar no painel. */
  L.direcoes = function (path) {
    const s = [];
    for (let i = 1; i < path.length; i++) {
      const dc = path[i][0] - path[i - 1][0];
      const dr = path[i][1] - path[i - 1][1];
      s.push(dr === -1 ? '↑' : dr === 1 ? '↓' : dc === -1 ? '←' : dc === 1 ? '→' : '?');
    }
    return s.join('');
  };

  /**
   * Pontos do arrasto em coordenadas de VIEWPORT (o que o CDP precisa).
   * passoPx → interpolação entre casas (menor = mais suave/humano).
   */
  L.plano = async function (opts) {
    opts = opts || {};
    if (!L.pronto()) await window.gcGarantirJogo(SLUG, L.pronto, { timeoutMs: 9000 });
    const cv = L.canvas();
    if (!cv) return { ok: false, erro: 'canvas ausente' };

    const puz = await L.loadPuzzle();
    const r = cv.getBoundingClientRect();
    const cel = r.width / (puz.cols || 7);

    // [col, row] — a ordem é essa MESMO (ver o ⚠️ do cabeçalho)
    const centro = ([col, row]) => ({
      x: Math.round(r.left + (col + 0.5) * cel),
      y: Math.round(r.top + (row + 0.5) * cel)
    });

    const casas = puz.solution_path.map(centro);
    const passos = opts.fast ? 1 : (opts.passos || 6);

    // pontos interpolados (o CDP precisa do movimento passo a passo para o
    // jogo registrar a passagem por cada casa)
    const pontos = [];
    pontos.push(casas[0]);
    for (let i = 1; i < casas.length; i++) {
      const a = casas[i - 1], b = casas[i];
      for (let s = 1; s <= passos; s++) {
        pontos.push({
          x: Math.round(a.x + (b.x - a.x) * s / passos),
          y: Math.round(a.y + (b.y - a.y) * s / passos)
        });
      }
    }
    return {
      ok: true, word: puz.word, clue: puz.clue, cols: puz.cols, rows: puz.rows,
      casas: casas, pontos: pontos, totalCasas: casas.length,
      direcoes: L.direcoes(puz.solution_path),
      canvas: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) }
    };
  };

  /** Painel com a palavra, a dica e o trajeto em setas. */
  L.painel = async function (status) {
    let puz;
    try { puz = await L.loadPuzzle(); } catch (e) { return null; }
    window.gcPainel('Labirinto', 'Palavra: ' + puz.word + '  (' + puz.word.length + ' letras)',
      [
        { titulo: 'Dica oficial', itens: [{ txt: puz.clue }] },
        { titulo: 'Trajeto (' + puz.solution_path.length + ' casas)', itens: [
          { txt: L.direcoes(puz.solution_path), nota: 'setas' }
        ] },
        { titulo: 'Letras na ordem', itens: puz.letter_positions.map((p, i) =>
          ({ txt: p[2], nota: '(' + p[0] + ',' + p[1] + ')' })) }
      ],
      status || 'Para jogar sozinho: comece na primeira letra e siga as setas.');
    return puz;
  };

  /**
   * Tenta resolver com eventos SINTÉTICOS (sem CDP). Se o jogo não registrar,
   * devolve { precisaCdp:true, plano } para o popup usar o chrome.debugger.
   */
  L.solve = async function (opts) {
    opts = opts || {};
    await window.gcFecharBloqueios(6);
    const p = await L.plano(opts);
    if (!p.ok) return p;
    await L.painel('sorteando o trajeto…');

    const cv = L.canvas();
    const antes = L.display();
    const mk = (tipo, pt, buttons) => new MouseEvent(tipo, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: pt.x, clientY: pt.y, button: 0, buttons: buttons
    });

    cv.dispatchEvent(mk('mousedown', p.casas[0], 1));
    await window.gcSleep(120);
    for (let i = 1; i < p.casas.length; i++) {
      const a = p.casas[i - 1], b = p.casas[i];
      for (let s = 1; s <= (opts.fast ? 1 : 5); s++) {
        cv.dispatchEvent(mk('mousemove', {
          x: Math.round(a.x + (b.x - a.x) * s / 5),
          y: Math.round(a.y + (b.y - a.y) * s / 5)
        }, 1));
        if (!opts.fast) await window.gcSleep(22);
      }
    }
    await window.gcSleep(150);
    cv.dispatchEvent(mk('mouseup', p.casas[p.casas.length - 1], 0));
    await window.gcSleep(1400);

    const depois = L.display();
    const progresso = depois.length > antes.length;
    const completo = window.gcNorm(depois) === window.gcNorm(p.word);

    await L.painel(progresso ? 'traço aplicado — confira a tela' : 'o jogo não aceitou o traço sintético');

    return {
      ok: progresso, game: 'labirinto', word: p.word, clue: p.clue,
      display: depois, completo: completo,
      precisaCdp: !progresso,        // ← o popup decide usar chrome.debugger
      plano: p
    };
  };

  window.__g1Labirinto = L;
  window.labirintoIsPage = L.isPage;
  window.labirintoDetect = L.detect;
  window.labirintoSolve = L.solve;
  window.labirintoPlano = L.plano;
  window.labirintoPainel = L.painel;
})();


/* ---------- revelar.js ---------- */

/**
 * revelar.js — MODO ASSISTIDO: mostra a solução, quem joga é você
 * ==============================================================
 * Em vez de preencher, este módulo PINTA a resposta na própria página e deixa a
 * jogada para o usuário. É a diferença entre "o robô resolve" e "o robô te diz a
 * resposta e você faz".
 *
 * Regra de ouro da implementação: **nunca sobrescrever o estado do jogo**. Todas
 * as marcas são elementos NOVOS, com a classe `__g1g_ghost`, clonados a partir do
 * próprio elemento do site (assim a geometria já vem certa) e com
 * `pointer-events: none` para não roubar clique. Nada é digitado, nada é
 * submetido — se o usuário não jogar, o jogo fica exatamente como estava.
 *
 * ⚠️ Os leitores do próprio projeto precisam ignorar os fantasmas, senão a
 * próxima detecção lerá a solução como se fosse valor do jogo (célula "preenchida"
 * que o jogo não conhece). Por isso `content.js:extractGrid` e o leitor do
 * cruzadão filtram `.__g1g_ghost`.
 *
 * Por jogo:
 *   g1 (sudoku)   → dígito fantasma em cada célula vazia
 *   dito          → palavra do dia fantasma na 1ª linha vazia (e no painel)
 *   soletra       → lista de palavras no painel, com ✔ ao vivo das que você acha
 *   combinado     → os 4 grupos no painel, coloridos por grupo
 *   labirinto     → trajeto desenhado SOBRE o canvas + letras marcadas
 *   wordsearch    → destaque das palavras na grade (reusa o que já existe)
 *   crossword     → letra fantasma em cada casa vazia
 */

(function () {
  'use strict';

  const CLASSE = '__g1g_ghost';
  const COR = '#e0457b';                 // rosa: contraste com o azul/verde do G1
  const R = {};

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── utilidades de "fantasma" ───────────────────────────────────────────────

  function limpar(raiz) {
    (raiz || document).querySelectorAll('.' + CLASSE).forEach(e => e.remove());
  }

  /**
   * Insere um fantasma dentro de `pai`, posicionado de forma absoluta.
   * `fonteCss` deve ser o font-size REAL do dígito do jogo — usar % da célula
   * deixa o fantasma ilegível quando o texto do número é maior que a célula.
   */
  function fantasmaDiv(pai, texto, fonteCss) {
    if (!pai) return null;
    if (getComputedStyle(pai).position === 'static') pai.style.position = 'relative';
    const s = document.createElement('span');
    s.className = CLASSE;
    s.textContent = texto;
    s.style.cssText = [
      'position:absolute', 'inset:0', 'display:flex', 'align-items:center',
      'justify-content:center', 'pointer-events:none', 'z-index:5',
      'color:' + COR, 'font-weight:700',
      'font-size:' + (fonteCss || '1.1em'), 'opacity:.78',
      'line-height:1', 'font-family:inherit'
    ].join(';');
    pai.appendChild(s);
    return s;
  }

  /** font-size computado do dígito do jogo (para o fantasma ter o mesmo porte). */
  function fonteDoDigito(cel) {
    const base = cel && (cel.querySelector('.cell-text') || cel.querySelector('SPAN'));
    if (!base) return null;
    const fs = getComputedStyle(base).fontSize;
    return (fs && fs !== '0px') ? fs : null;
  }

  /** Clona um <text> SVG do site (geometria pronta) e troca o conteúdo. */
  function fantasmaSvg(paiTextoSvg, conteudo) {
    if (!paiTextoSvg) return null;
    const c = paiTextoSvg.cloneNode(true);
    c.classList.add(CLASSE);
    c.removeAttribute('class');
    c.setAttribute('class', CLASSE);
    c.textContent = conteudo;
    c.style.fill = COR;
    c.style.opacity = '0.75';
    c.style.pointerEvents = 'none';
    c.style.fontWeight = '700';
    paiTextoSvg.parentNode.insertBefore(c, paiTextoSvg.nextSibling);
    return c;
  }

  // ── SUDOKU (G1) ────────────────────────────────────────────────────────────

  R.sudoku = async function (gd, opts) {
    limpar(document);
    if (!gd || !Array.isArray(gd.cells) || gd.cells.length !== 81) {
      return { ok: false, erro: 'grade 9x9 ausente' };
    }

    // ⚠️ `solutionFor` vive dentro do IIFE do content.js — NÃO é global. O que
    // existe é a versão exposta em window.__g1Helper (que o próprio content.js
    // publica para testes). Chamar a global direto devolvia "não consegui
    // resolver o tabuleiro" mesmo com a grade legível.
    const helper = window.__g1Helper || {};
    const resolver = helper.solutionFor || (typeof solutionFor === 'function' ? solutionFor : null);
    if (typeof resolver !== 'function') return { ok: false, erro: 'sem função de solução (content.js não carregou?)' };
    const solucao = resolver(gd);
    if (!solucao) return { ok: false, erro: 'não consegui resolver o tabuleiro' };

    let pintadas = 0;
    for (const cell of gd.cells) {
      if (cell.given) continue;                       // fixa nunca é vazia
      const quer = solucao[cell.row - 1][cell.col - 1];
      if (!(quer >= 1 && quer <= 9)) continue;
      if (cell.value === quer) continue;              // já está certo
      if (cell.value !== 0) continue;                 // respeita valor do usuário
      const alvo = (cell.click.closest ? cell.click.closest('.cell') : null) || cell.click.parentElement;
      const el = fantasmaDiv(alvo, String(quer), fonteDoDigito(alvo));
      if (el) pintadas++;
    }
    return { ok: true, tipo: 'sudoku', pintadas: pintadas, autoRefresh: true };
  };

  // ── DITO ───────────────────────────────────────────────────────────────────

  R.dito = async function (opts) {
    limpar(document);
    const r = await window.__g1Dito.palavraDeHoje();
    if (r.erro) return { ok: false, erro: r.erro };

    // primeira linha vazia do tabuleiro = onde o usuário vai digitar
    const linhas = [...document.querySelectorAll('.board .row')];
    const vazia = linhas.find(l => !(l.textContent || '').trim()) || linhas[0];
    let pintadas = 0;
    if (vazia) {
      [...vazia.children].forEach((casa, i) => {
        if (!r.palavra[i]) return;
        const base = casa.querySelector('SPAN') || casa.firstElementChild;
        const fs = base ? getComputedStyle(base).fontSize : null;
        if (fantasmaDiv(casa, r.palavra[i], fs && fs !== '0px' ? fs : '1.1em')) pintadas++;
      });
    }

    window.gcPainel('Dito', 'Modo assistido — a palavra de hoje é ' + r.palavra,
      [
        { titulo: 'Como jogar', itens: [
          { txt: 'Digite ' + r.palavra + ' e confirme', nota: '1 tentativa' },
          { txt: 'As letras estão em rosa na primeira linha vazia' }
        ] },
        { titulo: 'De onde vem', itens: [{ txt: 'base diária do próprio site', nota: r.total + ' palavras' }] }
      ],
      'Nada foi preenchido pelo helper: a jogada é sua.');
    return { ok: true, tipo: 'dito', palavra: r.palavra, pintadas: pintadas };
  };

  // ── SOLETRA ────────────────────────────────────────────────────────────────

  R.soletra = async function (opts) {
    const puz = await window.__g1Soletra.loadPuzzle();
    const achadas = () => {
      const c = window.__g1Soletra.contador();
      return c ? c.achadas : 0;
    };

    // pinta a lista no painel e atualiza o ✔ conforme o usuário acha as palavras
    let parar = false;
    R._soletraParar = () => { parar = true; };

    const desenhar = () => {
      const c = window.__g1Soletra.contador() || { achadas: 0, total: puz.word_count };
      const restantes = c.total - c.achadas;
      const itens = puz.word_list
        .slice()
        .sort((a, b) => (a.pangram !== b.pangram ? (a.pangram ? 1 : -1) : a.word.length - b.word.length))
        .map(w => ({ txt: w.word + (w.pangram ? ' ★' : ''), nota: w.score + 'p' }));
      window.gcPainel('Soletra',
        'Modo assistido — ' + c.achadas + '/' + c.total + ' encontradas  ·  faltam ' + restantes,
        [
          { titulo: 'Palavras do dia (' + puz.word_count + ')', itens: itens },
          { titulo: 'Letras', itens: [{ txt: puz.letters.toUpperCase().split('').join(' ') , nota: puz.pangram_count + ' pangramas' }] }
        ],
        '★ = pangrama (usa as 7 letras). Digite no jogo — o contador acima acompanha você.');
    };

    desenhar();
    (async () => {
      let ultimo = -1;
      while (!parar) {
        await sleep(1500);
        const c = achadas();
        if (c !== ultimo) { ultimo = c; desenhar(); }
      }
    })();

    return { ok: true, tipo: 'soletra', palavras: puz.word_count, autoRefresh: true };
  };

  // ── COMBINADO ──────────────────────────────────────────────────────────────

  R.combinado = async function (opts) {
    const puz = await window.__g1Combinado.loadPuzzle();
    const grupos = window.__g1Combinado.grupos(puz);
    const cores = ['#81C784', '#4FC3F7', '#FFD54F', '#F06292'];

    window.gcPainel('Combinado', 'Modo assistido — os 4 grupos estão listados',
      grupos.map((g, i) => ({
        titulo: g.nome,
        itens: g.palavras.map(p => ({ txt: p, cor: cores[i % 4] }))
      })),
      'Clique as 4 palavras de um grupo e confirme. O painel não clica nada por você.');

    // pinta um selo colorido nas células para casar painel × tabuleiro
    limpar(document.body);
    let pintadas = 0;
    for (let i = 0; i < grupos.length; i++) {
      for (const palavra of grupos[i].palavras) {
        const alvo = window.gcNorm(palavra);
        const cel = [...document.querySelectorAll('button.cell')]
          .find(c => window.gcNorm(c.textContent) === alvo);
        if (!cel) continue;
        const selo = document.createElement('span');
        selo.className = CLASSE;
        selo.style.cssText = 'position:absolute;top:3px;right:3px;width:9px;height:9px;border-radius:50%;' +
          'pointer-events:none;background:' + cores[i % 4];
        if (getComputedStyle(cel).position === 'static') cel.style.position = 'relative';
        cel.appendChild(selo);
        pintadas++;
      }
    }
    return { ok: true, tipo: 'combinado', grupos: grupos.length, pintadas: pintadas };
  };

  // ── LABIRINTO ──────────────────────────────────────────────────────────────

  R.labirinto = async function (opts) {
    await window.gcFecharBloqueios(6);
    const p = await window.labirintoPlano({ passos: 8 });
    if (!p.ok) return p;

    const cv = window.__g1Labirinto.canvas();
    if (!cv) return { ok: false, erro: 'canvas ausente' };
    limpar(document);

    // ⚠️ `casas` e `pontos` do plano estão em coordenadas de VIEWPORT ({x,y} já
    // calculados), não em [col,row]. Aqui viram coordenadas locais do canvas.
    const loc = c => ({ x: c.x - p.canvas.l, y: c.y - p.canvas.t });
    const lado = p.canvas.w;
    const NS = 'http://www.w3.org/2000/svg';

    // camada SVG sobre o canvas, alinhada ao canto do PRÓPRIO canvas
    const holder = cv.parentElement;
    if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
    const hr = holder.getBoundingClientRect(), cr = cv.getBoundingClientRect();

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', CLASSE);
    svg.setAttribute('viewBox', '0 0 ' + lado + ' ' + lado);
    svg.setAttribute('width', lado);
    svg.setAttribute('height', lado);
    svg.style.cssText = 'position:absolute;pointer-events:none;z-index:6' +
      ';left:' + Math.round(cr.left - hr.left) + 'px' +
      ';top:' + Math.round(cr.top - hr.top) + 'px';

    const linha = document.createElementNS(NS, 'polyline');
    linha.setAttribute('points', p.casas.map(c => { const q = loc(c); return q.x + ',' + q.y; }).join(' '));
    linha.setAttribute('fill', 'none');
    linha.setAttribute('stroke', COR);
    linha.setAttribute('stroke-width', String(Math.max(2, Math.round(lado / 140))));
    linha.setAttribute('stroke-opacity', '0.85');
    linha.setAttribute('stroke-linejoin', 'round');
    linha.setAttribute('stroke-dasharray', '6 4');
    svg.appendChild(linha);

    const marca = (x, y, txt, cor, raio) => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y);
      c.setAttribute('r', String(raio || 9));
      c.setAttribute('fill', cor); c.setAttribute('fill-opacity', '0.92');
      svg.appendChild(c);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y + 4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '11');
      t.setAttribute('font-weight', '700');
      t.setAttribute('fill', '#fff');
      t.textContent = txt;
      svg.appendChild(t);
    };

    const cel = lado / (p.cols || 7);
    const centro = (col, row) => loc({
      x: p.canvas.l + (col + 0.5) * cel,
      y: p.canvas.t + (row + 0.5) * cel
    });

    const inicio = loc(p.casas[0]);
    marca(inicio.x, inicio.y, '▶', '#2f7d43', 10);

    // cada letra da palavra, no lugar onde precisa ser coletada
    let letras = 0;
    try {
      const puz = await window.__g1Labirinto.loadPuzzle();
      (puz.letter_positions || []).forEach(lp => {
        const q = centro(lp[0], lp[1]);
        marca(q.x, q.y, String(lp[2]), COR, 9);
        letras++;
      });
    } catch (e) { /* sem as letras o trajeto continua valendo */ }

    holder.appendChild(svg);

    window.gcPainel('Labirinto', 'Modo assistido — ' + p.word + ' (' + p.word.length + ' letras)',
      [
        { titulo: 'Trajeto', itens: [{ txt: p.direcoes, nota: p.totalCasas + ' casas' }] },
        { titulo: 'Dica oficial', itens: [{ txt: p.clue }] },
        { titulo: 'Como jogar', itens: [
          { txt: 'Comece na casa com ▶ e siga a linha rosa' },
          { txt: 'Passe por TODAS as casas, como o traçado mostra' }
        ] }
      ],
      'A linha é só um desenho por cima — quem traça é você.');

    return { ok: true, tipo: 'labirinto', word: p.word, casas: p.totalCasas, letras: letras };
  };

  // ── CAÇA-PALAVRAS (já era assistido) ───────────────────────────────────────

  R.wordsearch = async function (gd, opts) {
    const puz = await window.wsLoadPuzzle();
    const palavras = window.wsSolve(puz);
    const res = await window.wsHighlight(palavras, opts || {});
    return {
      ok: !!res.ok, tipo: 'wordsearch', palavras: palavras.length,
      marcadas: res.marcadas,
      lista: palavras.map(w => w.palavra + ' (' + w.direcao + ')')
    };
  };

  // ── PALAVRAS CRUZADAS ──────────────────────────────────────────────────────

  R.crossword = async function (opts) {
    limpar(document);
    if (typeof cwLoadAnswer !== 'function' || typeof cwDetect !== 'function') {
      return { ok: false, erro: 'crossword.js não carregou' };
    }
    const ans = await cwLoadAnswer();
    const t = cwDetect();
    if (!t) return { ok: false, erro: 'tabuleiro não lido' };

    const NS = 'http://www.w3.org/2000/svg';

    let pintadas = 0;
    for (const c of t.cells) {
      const letra = ans.sol[c.col + ',' + c.row];
      if (!letra) continue;                       // casa preta / fora do gabarito
      if (c.valor === letra) continue;            // já preenchida certo
      if (c.valor) continue;                      // respeita o que o usuário escreveu
      const el = c.el || c;

      // ⚠️ Casa VAZIA não tem `text.value` para clonar — o site só cria esse
      // elemento quando a letra é digitada. Então aqui o fantasma é construído a
      // partir da geometria do próprio `<rect>` da casa (que existe sempre).
      const rc = el.querySelector('rect');
      const w = rc ? Number(rc.getAttribute('width')) || 0 : 0;
      const h = rc ? Number(rc.getAttribute('height')) || 0 : 0;
      const rx = rc ? Number(rc.getAttribute('x')) || 0 : 0;
      const ry = rc ? Number(rc.getAttribute('y')) || 0 : 0;
      if (!w || !h) continue;

      const txt = document.createElementNS(NS, 'text');
      txt.setAttribute('class', CLASSE);
      txt.setAttribute('x', String(rx + w / 2));
      txt.setAttribute('y', String(ry + h * 0.72));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', String(Math.round(h * 0.6)));
      txt.setAttribute('fill', COR);
      txt.setAttribute('fill-opacity', '0.75');
      txt.setAttribute('font-weight', '700');
      txt.setAttribute('pointer-events', 'none');
      txt.textContent = letra;
      el.appendChild(txt);
      pintadas++;
    }
    return { ok: true, tipo: 'crossword', pintadas: pintadas };
  };

  // ── porta de entrada ───────────────────────────────────────────────────────

  /**
   * Mostra a solução do jogo detectado (sem jogar por você).
   * `gd` é a detecção do content.js (pode vir nulo e é re-detectada aqui).
   */
  R.revelar = async function (gd, opts) {
    await window.gcFecharBloqueios(5);
    const g = gd || (window.__g1Helper ? await window.__g1Helper.detectGridWithRetry(6000) : null);
    if (!g) return { ok: false, erro: 'nenhum jogo detectado' };

    window.gcPainelStatus('mostrando a solução…');
    try {
      switch (g.strategy) {
        case 'g1':
        case 'table':
        case 'inputs': return await R.sudoku(g, opts);
        case 'dito': return await R.dito(opts);
        case 'soletra': return await R.soletra(opts);
        case 'combinado': return await R.combinado(opts);
        case 'labirinto': return await R.labirinto(opts);
        case 'wordsearch': return await R.wordsearch(g, opts);
        case 'crossword': return await R.crossword(opts);
        default: return { ok: false, erro: 'estratégia sem modo assistido: ' + g.strategy };
      }
    } catch (e) {
      return { ok: false, erro: String(e && e.message || e) };
    }
  };

  /** Remove todas as marcas (modo assistido) e, se pedido, o painel. */
  R.limparTudo = function (fecharPainel) {
    if (R._soletraParar) R._soletraParar();
    limpar(document);
    if (fecharPainel && typeof window.gcPainelFechar === 'function') window.gcPainelFechar();
    return { ok: true };
  };

  window.__g1Revelar = R;
  window.revelarJogo = R.revelar;
  window.revelarLimpar = R.limparTudo;
})();


/* ---------- content.js ---------- */

/**
 * G1 Games Helper — Content Script
 * =================================
 * Resolve sudoku automaticamente em:
 *   - G1 Globo  (g1.globo.com/jogos/sudoku)  -> CSS Grid (DIV.cell)
 *   - Sudoku.com                            -> canvas + localStorage (gabarito local)
 *   - Qualquer tabela 9x9 ou 81 inputs      -> fallback genérico
 *
 * IMPORTANTE (descoberta empírica):
 *   - O G1 exige LOGIN para liberar os botões de dificuldade. Sem login, os
 *     `.start-btn` vêm `disabled` e existe um `.modal-overlay` de login.
 *     Nesse caso não há board na página e nada pode ser detectado.
 *   - O sudoku.com desenha o tabuleiro em <canvas> (não há DOM de células),
 *     MAS guarda `mission` (puzzle) e `solution` (gabarito) em
 *     localStorage['main_game']. Ler dali é 100% confiável (sem OCR).
 */

(function () {
  'use strict';

  const TAG = '[G1-Games-Helper]';
  const log = (...a) => console.log(TAG, ...a);

  // Geometria do canvas do sudoku.com (descoberta empiricamente e validada
  // contra os dígitos do `mission`): padding 8px, célula (W-16)/9 em 2000x2000.
  const CANVAS_PAD = 8;

  let detected = null; // cache da última detecção

  // ────────────────────────────────────────────────────────────────────────────
  // DIAGNÓSTICO — por que não detectou?
  // ────────────────────────────────────────────────────────────────────────────

  function diagnosePage() {
    const d = {
      url: location.href,
      site: 'unknown',
      cells: 0,
      startButtons: 0,
      startButtonsDisabled: false,
      loginModalVisible: false,
      hasCanvas: false,
      hasGameStorage: false,
      issues: []
    };

    if (/g1\.globo\.com\/jogos/.test(location.href)) {
      d.site = 'g1';
      const btns = document.querySelectorAll('.start-btn');
      d.startButtons = btns.length;
      d.startButtonsDisabled = btns.length > 0 &&
        Array.from(btns).every(b => b.disabled || b.getAttribute('aria-disabled') === 'true');

      const overlays = document.querySelectorAll('.modal-overlay, .globo-login-wrapper .modal');
      for (const o of overlays) {
        const r = o.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(o).display !== 'none') {
          d.loginModalVisible = true;
          break;
        }
      }

      d.cells = document.querySelectorAll('DIV.cell').length;

      if (d.loginModalVisible || d.startButtonsDisabled) {
        d.issues.push('G1_LOGIN_REQUIRED');
      } else if (d.cells === 0) {
        d.issues.push('G1_BOARD_NOT_STARTED');
      }
    } else if (/sudoku\.com/.test(location.href)) {
      d.site = 'sudoku.com';
      d.hasCanvas = !!document.querySelector('#game canvas');
      try {
        d.hasGameStorage = !!localStorage.getItem('main_game');
      } catch (e) { /* localStorage bloqueado */ }
      if (!d.hasCanvas) d.issues.push('SUDOKUCOM_NO_CANVAS');
      if (!d.hasGameStorage) d.issues.push('SUDOKUCOM_BOARD_NOT_STARTED');
    } else {
      if (document.querySelector('DIV.cell') && document.querySelectorAll('DIV.cell').length === 81) {
        d.site = 'g1-like';
      } else if (document.querySelectorAll('table').length > 0) {
        d.site = 'table';
      } else if (document.querySelectorAll('input').length >= 81) {
        d.site = 'inputs';
      }
    }
    return d;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // DETECÇÃO DE GRID
  // ────────────────────────────────────────────────────────────────────────────

  /** G1 Globo: DIV.cell com grid-row-start / grid-column-start */
  function detectG1() {
    const cells = document.querySelectorAll('DIV.cell');
    if (cells.length !== 81) return null;

    const out = [];
    for (const cell of cells) {
      const style = cell.getAttribute('style') || '';
      const m = style.match(/grid-row-start:\s*(\d+).*grid-column-start:\s*(\d+)/s);
      if (!m) continue;
      const row = parseInt(m[1], 10);
      const col = parseInt(m[2], 10);

      let value = 0;
      let given = false;
      // O G1 permite ANOTAÇÕES (vários dígitos pequenos na mesma célula) no modo
      // "anotar". Se eu pegar o primeiro span com dígito, leio uma anotação como
      // se fosse o valor => grid inconsistente => solver falha. Então:
      //   1) ignoro spans cuja classe pareça de anotação;
      //   2) prefiro o valor que NÃO é de usuário quando houver ambiguidade.
      const spans = [...cell.querySelectorAll('SPAN')];
      for (const span of spans) {
        const cls = String(span.className || '');
        const t = (span.innerText || '').trim();
        if (!/^[1-9]$/.test(t)) continue;
        // ⚠️ No modo assistido (revelar.js) cada célula vazia ganha um SPAN com a
        // solução. Sem este filtro a próxima detecção leria o fantasma como valor
        // do jogo — e o tabuleiro apareceria "resolvido" sem o jogo saber disso.
        if (cls.indexOf('__g1g_ghost') !== -1) continue;
        if (/note|annot|pencil|anota|small|candidate|corner|center/i.test(cls)) continue;
        value = parseInt(t, 10);
        given = !cls.includes('user-number');
        break;
      }
      // Se todos os dígitos achados eram anotações, não há valor real aqui.
      if (value === 0 && spans.some(s =>
            /^[1-9]$/.test((s.innerText || '').trim()) &&
            String(s.className || '').indexOf('__g1g_ghost') === -1)) {
        value = -1;   // marca: célula tem dígitos mas todos parecem anotação
      }

      out.push({
        row, col, value, given,
        click: cell.querySelector('.cell-btn') || cell.querySelector('BUTTON') || cell
      });
    }
    if (out.length !== 81) return null;
    return { strategy: 'g1', cells: out };
  }

  /** Sudoku.com: canvas + localStorage (mission/solution) */
  function detectSudokuCom() {
    const canvas = document.querySelector('#game canvas');
    if (!canvas) return null;

    let state = null;
    try {
      const raw = localStorage.getItem('main_game');
      if (raw) state = JSON.parse(raw);
    } catch (e) { log('erro ao ler main_game:', e.message); }
    if (!state) return null;

    const mission = state.mission;
    const solution = state.solution;
    const values = state.values;

    // Monta o puzzle: prefere `mission`; cai para `values` se ausente.
    let gridFromMission = null;
    if (typeof mission === 'string' && mission.length === 81) {
      gridFromMission = mission.split('').map(c => (c === '0' ? 0 : parseInt(c, 10)));
    }

    const current = [];           // estado atual na tela
    const givenFlags = [];
    if (Array.isArray(values) && values.length === 81) {
      for (let i = 0; i < 81; i++) {
        const v = values[i] || {};
        current.push(typeof v.val === 'number' ? v.val : 0);
        givenFlags.push(v.editable === false);
      }
    } else if (gridFromMission) {
      for (let i = 0; i < 81; i++) {
        current.push(gridFromMission[i]);
        givenFlags.push(gridFromMission[i] !== 0);
      }
    } else {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const W = canvas.width;
    const CS = (W - 2 * CANVAS_PAD) / 9;

    const cells = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = r * 9 + c;
        cells.push({
          row: r + 1,
          col: c + 1,
          value: current[i],
          given: givenFlags[i],
          click: canvas,
          canvasX: CANVAS_PAD + (c + 0.5) * CS,
          canvasY: CANVAS_PAD + (r + 0.5) * CS,
          scaleX: rect.width / W,
          scaleY: rect.height / W,
          rectLeft: rect.left,
          rectTop: rect.top
        });
      }
    }

    return {
      strategy: 'sudoku.com',
      cells,
      canvas,
      knownSolution: (typeof solution === 'string' && solution.length === 81)
        ? solution.split('').map(c => parseInt(c, 10))
        : null
    };
  }

  /** Tabela HTML 9x9 */
  function detectTable() {
    for (const table of document.querySelectorAll('table')) {
      const rows = table.querySelectorAll('tr');
      if (rows.length !== 9) continue;
      const cells = [];
      let ok = true;
      for (let r = 0; r < 9 && ok; r++) {
        const cols = rows[r].querySelectorAll('td, th');
        if (cols.length !== 9) { ok = false; break; }
        for (let c = 0; c < 9; c++) {
          const t = (cols[c].innerText || '').trim();
          const value = /^[1-9]$/.test(t) ? parseInt(t, 10) : 0;
          cells.push({ row: r + 1, col: c + 1, value, given: value !== 0, click: cols[c] });
        }
      }
      if (ok && cells.length === 81) return { strategy: 'table', cells };
    }
    return null;
  }

  /** 81 inputs */
  function detectInputs() {
    const all = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
    if (all.length !== 81) return null;
    const cells = [];
    for (let i = 0; i < 81; i++) {
      const v = (all[i].value || '').trim();
      const value = /^[1-9]$/.test(v) ? parseInt(v, 10) : 0;
      cells.push({
        row: Math.floor(i / 9) + 1,
        col: (i % 9) + 1,
        value, given: false, click: all[i]
      });
    }
    return { strategy: 'inputs', cells };
  }

  function detectGrid() {
    // Jogos de palavra/canvas do G1 primeiro (cada um só responde na própria URL),
    // depois as grades de sudoku/cruzadas.
    return detectDito() || detectSoletra() || detectCombinado() || detectLabirinto() ||
           detectWordsearch() || detectCrossword() || detectG1() || detectSudokuCom() ||
           detectTable() || detectInputs();
  }

  /** Wrapper: cada módulo só responde na própria página e não pode derrubar a cadeia. */
  function detectJogo(nome, fn) {
    if (typeof fn !== 'function') return null;
    try { return fn(); } catch (e) { log(nome + ' detect falhou:', e.message); return null; }
  }

  /** Dito (Wordle do G1) — a base de palavras do dia vem embutida no chunk do site. */
  function detectDito() {
    if (typeof ditoDetect !== 'function') return null;
    const d = detectJogo('dito', ditoDetect);
    return d ? Object.assign(d, { strategy: 'dito' }) : null;
  }

  /** Soletra (Spelling Bee) — gabarito em /jogos/static/soletra.json. */
  function detectSoletra() {
    if (typeof soletraDetect !== 'function') return null;
    const d = detectJogo('soletra', soletraDetect);
    return d ? Object.assign(d, { strategy: 'soletra' }) : null;
  }

  /** Combinado (Connections) — gabarito em /jogos/static/combinado.json. */
  function detectCombinado() {
    if (typeof combinadoDetect !== 'function') return null;
    const d = detectJogo('combinado', combinadoDetect);
    return d ? Object.assign(d, { strategy: 'combinado' }) : null;
  }

  /** Labirinto — canvas + caminho completo em /jogos/static/labirinto.json. */
  function detectLabirinto() {
    if (typeof labirintoDetect !== 'function') return null;
    const d = detectJogo('labirinto', labirintoDetect);
    return d ? Object.assign(d, { strategy: 'labirinto' }) : null;
  }

  /** Caça-Palavras do G1 (SVG 12x12). O gabarito vem do JSON estático da g1. */
  function detectWordsearch() {
    if (typeof wsDetect !== 'function') return null;
    try { return wsDetect(); }
    catch (e) { log('wordsearch detect falhou:', e.message); return null; }
  }

  /** Palavras Cruzadas Mini do G1 (SVG). O gabarito vem do JSON da própria g1. */
  function detectCrossword() {
    if (typeof cwDetect !== 'function') return null;
    try { return cwDetect(); }
    catch (e) { log('crossword detect falhou:', e.message); return null; }
  }

  /** G1: board das palavras cruzadas carregado? (para o diagnóstico) */
  function crosswordDiag() {
    if (typeof cwIsPage !== 'function' || !cwIsPage()) return null;
    return {
      site: 'palavras-cruzadas',
      celulas: document.querySelectorAll('g.cell').length,
      svg: !!document.querySelector('svg')
    };
  }

  /** Aguarda o tabuleiro existir (o board pode demorar a renderizar). */
  async function detectGridWithRetry(timeoutMs = 8000) {
    // Palavras cruzadas: antes de tudo, garante que o jogo está ABERTO
    // (dispensa o modal de login e clica em "Iniciar" — sem isso `g.cell` = 0)
    if (typeof cwEnsureGame === 'function' && typeof cwIsPage === 'function' && cwIsPage()) {
      try { await cwEnsureGame(9000); } catch (e) { log('cwEnsureGame:', e.message); }
    }
    // Caça-Palavras: idem — o board SVG só existe depois de "Iniciar"
    if (typeof wsEnsureGame === 'function' && typeof wsIsPage === 'function' && wsIsPage()) {
      try { await wsEnsureGame(9000); } catch (e) { log('wsEnsureGame:', e.message); }
    }
    // Jogos novos (dito/soletra/combinado/labirinto): mesma coisa + fechar o TOUR
    // de boas-vindas, que cobre o tabuleiro e engole os cliques.
    if (typeof gcGarantirJogo === 'function') {
      const novos = [
        ['dito', typeof ditoIsPage === 'function' && ditoIsPage(), () => !!document.querySelectorAll('.board .row').length],
        ['soletra', typeof soletraIsPage === 'function' && soletraIsPage(), () => !!document.querySelector('#input') && !!document.querySelector('.letters')],
        ['combinado', typeof combinadoIsPage === 'function' && combinadoIsPage(), () => document.querySelectorAll('button.cell').length >= 16],
        ['labirinto', typeof labirintoIsPage === 'function' && labirintoIsPage(), () => {
          const cv = document.querySelector('.labirinto-canvas__canvas');
          return !!cv && cv.getBoundingClientRect().width > 0;
        }]
      ];
      for (const [nome, eh, pronto] of novos) {
        if (!eh) continue;
        try {
          const r = await gcGarantirJogo(nome, pronto, { timeoutMs: 9000 });
          log('garantirJogo', nome, JSON.stringify(r));
        } catch (e) { log('garantirJogo ' + nome + ':', e.message); }
      }
    }
    const t0 = Date.now();
    let g = detectGrid();
    while (!g && Date.now() - t0 < timeoutMs) {
      await sleep(400);
      g = detectGrid();
    }
    return g;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // EXTRAÇÃO / SOLUÇÃO
  // ────────────────────────────────────────────────────────────────────────────

  function extractGrid(gd) {
    const grid = Array.from({ length: 9 }, () => Array(9).fill(0));
    let filled = 0;
    let suspect = 0;   // células com dígitos que parecem ANOTAÇÃO (valor não confiável)
    for (const c of gd.cells) {
      if (c.value > 0) { filled++; grid[c.row - 1][c.col - 1] = c.value; }
      else if (c.value < 0) suspect++;
    }
    return { grid, filled, empty: 81 - filled, suspect };
  }

  function solutionFor(gd) {
    // Se o site já nos deu o gabarito (sudoku.com), usa direto.
    if (gd.knownSolution) {
      const grid = [];
      for (let r = 0; r < 9; r++) grid.push(gd.knownSolution.slice(r * 9, r * 9 + 9));
      return grid;
    }
    const { grid } = extractGrid(gd);
    return solveSudoku(grid.map(r => r.slice()));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PREENCHIMENTO
  // ────────────────────────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /**
   * Despausa overlays que bloqueiam o jogo.
   * - sudoku.com: #pause-overlay
   * - G1 Jogos: overlay "Seu jogo foi pausado" com botão "Voltar"
   *   (o G1 pausa sozinho quando a página perde o foco — ex.: popup da extensão)
   */
  async function ensureNotPaused() {
    // --- sudoku.com ---
    const ov = document.querySelector('#pause-overlay');
    if (ov) {
      const s = getComputedStyle(ov);
      if (s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.1) {
        const r = ov.getBoundingClientRect();
        ['pointerdown', 'pointerup', 'click'].forEach(t =>
          ov.dispatchEvent(new PointerEvent(t, {
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
            bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true
          }))
        );
        await sleep(500);
      }
    }

    // --- G1 / genérico: overlay de pausa por TEXTO ---
    // Busca o container que mencione "pausado" e clica no botão dentro dele.
    // Usa textContent (NÃO innerText, que força reflow em cada elemento e fica
    // lento em páginas grandes como o G1) e para no primeiro candidato com botão.
    // Filtrar por texto evita acertar o botão de navegação "voltar" do cabeçalho.
    const PAUSE_WORDS = ['pausado', 'pausada', 'paused'];
    let pauseBtn = null;
    for (const el of document.querySelectorAll('div, section, article')) {
      const txt = el.textContent || '';
      if (txt.length === 0 || txt.length > 250) continue;
      const low = txt.toLowerCase();
      if (!PAUSE_WORDS.some(w => low.includes(w))) continue;
      const btn = el.querySelector('button, [role="button"], .button');
      if (btn) { pauseBtn = btn; break; }
    }
    if (pauseBtn) {
      log('despausando via overlay de pausa');
      pauseBtn.click();
      await sleep(600);
      return true;
    }
    return false;
  }

  /** G1: clica na célula e no botão do teclado numérico. */
  async function fillCellG1(cell, value, delay) {
    cell.click.click();
    await sleep(delay);
    for (const k of document.querySelectorAll('.btn-key')) {
      if ((k.innerText || '').trim() === String(value)) {
        k.click();
        await sleep(delay);
        return true;
      }
    }
    return false;
  }

  /** Sudoku.com: clique por coordenadas no canvas + numpad. */
  async function fillCellSudokuCom(cell, value, delay) {
    const canvas = cell.click;
    const sx = cell.rectLeft + cell.canvasX * cell.scaleX;
    const sy = cell.rectTop + cell.canvasY * cell.scaleY;
    const opts = {
      clientX: sx, clientY: sy, bubbles: true, cancelable: true, view: window,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    canvas.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
    await sleep(delay);

    const np = document.querySelector(`.numpad-item[data-value="${value}"]`);
    if (np) {
      np.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, opts, {
        clientX: np.getBoundingClientRect().left + 5, clientY: np.getBoundingClientRect().top + 5
      })));
      np.click();
      await sleep(delay);
      return true;
    }
    return false;
  }

  /** Inputs: escreve direto e dispara eventos. */
  async function fillCellInput(cell, value, delay) {
    const el = cell.click;
    el.focus();
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(delay);
    return true;
  }

  /**
   * Sudoku.com: monta o PLANO DE CLIQUES (coordenadas na viewport) para o
   * executor do background, que usa chrome.debugger (input REAL).
   *
   * Por que não preencher daqui: o jogo desenha no <canvas> e IGNORA eventos
   * sintéticos — testado mousemove/mousedown/mouseup/click, PointerEvent
   * completo e até isTrusted forjado. Nada seleciona a célula, então o numpad
   * aplica o número em outra célula (ou em nada).
   */
  function buildClickPlan(solution) {
    const gd = detected;
    if (!gd || gd.strategy !== 'sudoku.com' || !gd.canvas) return null;

    const r = gd.canvas.getBoundingClientRect();
    const W = gd.canvas.width;
    const CS = (W - 2 * CANVAS_PAD) / 9;
    const k = r.width / W;
    const pt = (row, col) => ({
      x: Math.round(r.left + (CANVAS_PAD + (col - 0.5) * CS) * k),
      y: Math.round(r.top + (CANVAS_PAD + (row - 0.5) * CS) * k)
    });

    // teclado numérico do site
    const numpad = {};
    for (const el of document.querySelectorAll('.numpad-item')) {
      const v = el.getAttribute('data-value');
      if (!v) continue;
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      numpad[v] = { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    }

    // células a preencher (pula fixas, já corretas e chutes existentes)
    const cells = [];
    for (const cell of gd.cells) {
      if (cell.given) continue;
      const want = solution[cell.row - 1][cell.col - 1];
      if (!(want >= 1 && want <= 9)) continue;
      if (cell.value === want) continue;
      if (cell.value !== 0) continue;
      const p = pt(cell.row, cell.col);
      cells.push({ row: cell.row, col: cell.col, value: want, x: p.x, y: p.y });
    }

    return {
      strategy: 'sudoku.com',
      cells,
      numpad,
      // fecha com clique (DOM comum)
      closeSelectors: ['.popup-close'],
      // ESCONDE: anuncios que cobrem o tabuleiro com pointer-events:auto.
      // O `.ima-container` (Google IMA) fica com z-index 99 sobre o canvas e
      // engole TODOS os cliques -> os numeros caem na celula errada (3 erros =
      // fim de jogo). Descoberto na pratica; esconder e o unico jeito confiavel.
      hideSelectors: ['.ima-container', 'iframe[id*=google_ads]', '.vidazoo-float']
    };
  }

  async function actionPlan(solution) {
    const gd = detected || await detectGridWithRetry(4000);
    if (!gd) return { success: false, reason: 'no-grid', diag: diagnosePage() };
    detected = gd;
    const plan = buildClickPlan(solution);
    if (!plan) {
      return {
        success: false, reason: 'nao-sudoku-com', strategy: gd.strategy,
        hint: 'O caminho por CDP só é necessário quando o tabuleiro é <canvas> (sudoku.com).'
      };
    }
    return { success: true, plan, total: plan.cells.length, strategy: gd.strategy };
  }

  async function fillCells(gd, solution, opts = {}) {
    const human = opts.human !== false;
    const speed = opts.speed || 1;
    const filled = [];
    for (const cell of gd.cells) {
      if (cell.given) continue;                       // não mexe em célula fixa
      const want = solution[cell.row - 1][cell.col - 1];
      if (!(want >= 1 && want <= 9)) continue;
      if (cell.value === want) continue;              // já está correto
      if (cell.value !== 0) continue;                 // não sobrescreve chute existente

      // modo humanizado: pausa variável, como quem pensa antes de digitar
      const d = human ? Math.round((220 + Math.random() * 320) / speed) : Math.round(70 / speed);

      let ok = false;
      if (gd.strategy === 'g1') ok = await fillCellG1(cell, want, d);
      else if (gd.strategy === 'sudoku.com') ok = await fillCellSudokuCom(cell, want, d);
      else if (gd.strategy === 'inputs') ok = await fillCellInput(cell, want, d);
      else { cell.click.click(); ok = true; await sleep(d); }

      if (ok) filled.push({ row: cell.row, col: cell.col, value: want });

      // a cada ~12 células, uma pausa maior (quem joga de verdade para e olha)
      if (human && filled.length && filled.length % 12 === 0) {
        await sleep(Math.round((600 + Math.random() * 900) / speed));
      }
    }
    return filled;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AÇÕES (chamadas pelo popup)
  // ────────────────────────────────────────────────────────────────────────────

  async function actionDetect() {
    await ensureNotPaused();          // o G1 pausa ao perder foco (popup) e esconde/renderiza o board
    await sleep(300);
    const diag = diagnosePage();
    const gd = await detectGridWithRetry(6000);
    detected = gd;
    if (!gd) return { found: false, diag };
    // Jogos de palavra/canvas (dito, soletra, combinado, labirinto): não existe
    // grade 9x9 — o popup mostra o resumo do módulo e o painel na página.
    if (JOGOS_MODULO.indexOf(gd.strategy) !== -1) {
      return { found: true, strategy: gd.strategy, game: gd.strategy,
               info: gd, filled: 0, empty: 0, diag };
    }

    // Caça-Palavras: não é grade de sudoku — a "resposta" é o destaque das palavras
    if (gd.strategy === 'wordsearch') {
      return { found: true, strategy: 'wordsearch', grade: gd.grade,
               celulas: gd.celulas, palavras: (gd.palavras || null), filled: 0, empty: 0, diag };
    }

    const { filled, empty } = extractGrid(gd);
    return { found: true, strategy: gd.strategy, filled, empty, diag };
  }

  async function actionExtract() {
    const gd = detected || await detectGridWithRetry(4000);
    if (!gd) return { found: false, diag: diagnosePage() };
    detected = gd;
    if (gd.strategy === 'crossword') {
      return { found: true, strategy: 'crossword', grid: cwAsGrid(gd),
               filled: gd.preenchidas, empty: gd.vazias, cols: gd.cols, rows: gd.rows };
    }
    const { grid, filled, empty } = extractGrid(gd);
    return { found: true, strategy: gd.strategy, grid, filled, empty };
  }

  async function actionSolve() {
    const gd = detected || await detectGridWithRetry(4000);
    if (!gd) return { found: false, diag: diagnosePage() };
    detected = gd;

    // Palavras cruzadas: o gabarito vem pronto no JSON da g1 (nada a calcular).
    if (gd.strategy === 'crossword') {
      const grid = cwAsGrid(gd);
      try {
        const ans = await cwLoadAnswer();
        const sol = grid.map(l => l.slice());
        for (const k of Object.keys(ans.sol)) {
          const [c, r] = k.split(',').map(Number);
          if (sol[r]) sol[r][c] = ans.sol[k];
        }
        return { found: true, solvable: true, solution: sol, grid, crossword: true,
                 fromSite: true, filled: gd.preenchidas, empty: gd.vazias, palavras: ans.palavras.length };
      } catch (e) {
        return { found: true, solvable: false, reason: 'crossword-json', detail: String(e.message || e),
                 grid, crossword: true, filled: gd.preenchidas, empty: gd.vazias };
      }
    }

    const { grid, filled, empty, suspect } = extractGrid(gd);
    const fromSite = !!gd.knownSolution;
    const solution = solutionFor(gd);

    if (solution) {
      return { found: true, solvable: true, solution, grid, filled, empty, suspect, fromSite };
    }

    // Não resolveu — descobrir POR QUÊ (leitura errada vs puzzle sem solução).
    const gridValid = validateGrid(grid.map(r => r.slice()));
    return {
      found: true, solvable: false, grid, filled, empty, suspect, fromSite, gridValid,
      reason: !gridValid ? 'invalid-grid-read'
            : (suspect > 0 ? 'notes-confuse-read' : 'unsolvable')
    };
  }

  // Jogos que NÃO são grade de sudoku e têm módulo próprio
  const JOGOS_MODULO = ['dito', 'soletra', 'combinado', 'labirinto'];

  /**
   * Despacha para o módulo do jogo. Devolve null quando a estratégia não é de
   * um desses jogos (aí o fluxo de sudoku/cruzadas segue normal).
   */
  async function resolverJogo(gd, opts) {
    if (JOGOS_MODULO.indexOf(gd.strategy) === -1) return null;
    const o = opts || {};
    try {
      const mods = {
        dito: typeof ditoSolve === 'function' ? ditoSolve : null,
        soletra: typeof soletraSolve === 'function' ? soletraSolve : null,
        combinado: typeof combinadoSolve === 'function' ? combinadoSolve : null,
        labirinto: typeof labirintoSolve === 'function' ? labirintoSolve : null
      };
      const fn = mods[gd.strategy];
      if (!fn) return { success: false, strategy: gd.strategy, reason: 'modulo-ausente' };
      const r = await fn(o);
      return Object.assign({ success: !!r.ok, strategy: gd.strategy, game: gd.strategy }, r);
    } catch (e) {
      return { success: false, strategy: gd.strategy, reason: String(e && e.message || e) };
    }
  }

  /**
   * MODO ASSISTIDO: mostra a solução na página sem jogar. Quem preenche é o
   * usuário — nada é digitado, nada é submetido (ver revelar.js).
   */
  async function actionRevelar(opts) {
    if (typeof revelarJogo !== 'function') {
      return { success: false, reason: 'modulo-assistido-ausente' };
    }
    const gd = detected || await detectGridWithRetry(6000);
    if (!gd) return { success: false, reason: 'no-grid-detected', diag: diagnosePage() };
    detected = gd;
    const r = await revelarJogo(gd, opts || {});
    return Object.assign({ success: !!r.ok, strategy: gd.strategy, modo: 'assistido' }, r);
  }

  async function actionFill(solution, opts) {
    const gd = detected || await detectGridWithRetry(4000);
    if (!gd) return { success: false, reason: 'no-grid', diag: diagnosePage() };
    detected = gd;

    const porModulo = await resolverJogo(gd, opts);
    if (porModulo) return porModulo;

    // Caça-Palavras: destaca as respostas na grade (o jogador marca com o mouse).
    // O componente é Svelte 5 com event delegation — eventos sintéticos não
    // acionam a seleção do jogo (ver docs/REFERENCIA.md §8).
    if (gd.strategy === 'wordsearch') {
      try {
        const puz = await wsLoadPuzzle();
        const palavras = wsSolve(puz);
        const res = await wsHighlight(palavras, opts || {});
        return {
          success: !!res.ok, strategy: 'wordsearch', palavras: palavras.length,
          marcadas: res.marcadas, faltou: (res.faltou || []).length,
          lista: palavras.map(w => w.palavra + ' (' + w.direcao + ', ' + w.casas.length + ')')
        };
      } catch (e) {
        return { success: false, reason: 'wordsearch-json: ' + String(e.message || e) };
      }
    }

    // Palavras cruzadas: preenche com o gabarito do JSON (aqui eventos sintéticos bastam)
    if (gd.strategy === 'crossword') {
      try {
        const ans = await cwLoadAnswer();
        const res = await cwFill(ans, opts || {});
        return { success: !!res.success, filled: res.preenchidas, total: res.total,
                 errors: res.erros, strategy: 'crossword' };
      } catch (e) {
        return { success: false, reason: 'crossword-json: ' + String(e.message || e) };
      }
    }

    if (!Array.isArray(solution) || solution.length !== 9) {
      return { success: false, reason: 'invalid-solution' };
    }
    await ensureNotPaused();
    const done = await fillCells(gd, solution, opts || {});
    return { success: true, filled: done.length, strategy: gd.strategy };
  }

  async function actionAuto(opts) {
    const gd = await detectGridWithRetry(6000);
    if (!gd) return { success: false, reason: 'no-grid-detected', diag: diagnosePage() };
    detected = gd;

    const porModulo = await resolverJogo(gd, opts);
    if (porModulo) return porModulo;

    if (gd.strategy === 'wordsearch') {
      try {
        const puz = await wsLoadPuzzle();
        const palavras = wsSolve(puz);
        const res = await wsHighlight(palavras, opts || {});
        return {
          success: !!res.ok, strategy: 'wordsearch', filled: 0, totalEmpty: 0,
          palavras: palavras.length, marcadas: res.marcadas,
          lista: palavras.map(w => w.palavra)
        };
      } catch (e) {
        return { success: false, reason: 'wordsearch-json: ' + String(e.message || e) };
      }
    }

    if (gd.strategy === 'crossword') {
      try {
        const ans = await cwLoadAnswer();
        const res = await cwFill(ans, opts || {});
        return { success: !!res.success, filled: res.preenchidas, total: res.total,
                 errors: res.erros, strategy: 'crossword', totalEmpty: gd.vazias };
      } catch (e) {
        return { success: false, reason: 'crossword-json: ' + String(e.message || e) };
      }
    }

    await ensureNotPaused();

    const { grid, filled, empty } = extractGrid(gd);
    const solution = solutionFor(gd);
    if (!solution) return { success: false, reason: 'unsolvable', grid, filled, empty };

    const done = await fillCells(gd, solution, opts || {});
    return {
      success: true, filled: done.length, strategy: gd.strategy,
      fromSite: !!gd.knownSolution, totalEmpty: empty
    };
  }

  const onMessage = (msg, sender, sendResponse) => {
    log('mensagem:', msg && msg.action);
    const A = msg && msg.action;

    if (A === 'ping') { sendResponse({ ok: true }); return; }

    const run = async () => {
      try {
        if (A === 'diagnose') return { diag: diagnosePage() };
        if (A === 'detect') return await actionDetect();
        if (A === 'extract') return await actionExtract();
        if (A === 'solve') return await actionSolve();
        if (A === 'fill') return await actionFill(msg.solution, msg.opts);
        if (A === 'plan') return await actionPlan(msg.solution);
        if (A === 'auto') return await actionAuto(msg.opts);
        if (A === 'revelar') return await actionRevelar(msg.opts);
        if (A === 'limpar-marcas') {
          if (typeof revelarLimpar === 'function') return revelarLimpar(true);
          if (typeof gcPainelFechar === 'function') gcPainelFechar();
          return { ok: true };
        }
        if (A === 'limpar-painel') { if (typeof gcPainelFechar === 'function') gcPainelFechar(); return { ok: true }; }
        return { error: 'unknown-action' };
      } catch (e) {
        log('erro na ação', A, e);
        return { error: String(e && e.message || e) };
      }
    };

    run().then(sendResponse);
    return true; // resposta assíncrona
  };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(onMessage);
  }

  // Exposto para debug/teste fora do contexto de extensão
  if (typeof window !== 'undefined') {
    window.__g1Helper = {
      diagnosePage, detectGrid, detectGridWithRetry, extractGrid, solutionFor,
      fillCells, actionDetect, actionExtract, actionSolve, actionAuto, actionFill,
      actionRevelar, resolverJogo, JOGOS_MODULO
    };
  }

  log('content script carregado em', location.href);
})();


/* ---------- userscript/ui.js (exclusivo do userscript) ---------- */

/**
 * ui.js — menu do G1 Games Helper na versão USERSCRIPT
 * ====================================================
 * Na extensão o menu é o popup. Aqui não existe popup, então o menu vive na
 * própria página: um botão flutuante 🧩 que abre um cartão com
 *   • o jogo detectado e a métrica dele,
 *   • o botão de ação (rotulado pelo jogo),
 *   • o ritmo (Humano / Normal / Rápido),
 *   • o atalho para cada jogo suportado,
 *   • o aviso de recurso indisponível quando é o caso (Labirinto).
 *
 * Nada de framework: CSS injetado uma vez + DOM direto. Funciona em Tampermonkey,
 * Violentmonkey, Greasemonkey e afins, e também se o script for injetado à mão
 * (é assim que os testes rodam).
 */

(function () {
  'use strict';

  const UI = {};
  const ID_BTN = '__g1u_btn';
  const ID_CARD = '__g1u_card';
  const ID_CSS = '__g1u_css';
  const CHAVE_RITMO = '__g1u_ritmo';
  const CHAVE_ACAO = '__g1u_acao_modo';

  const JOGOS = [
    { id: 'dito', nome: 'Dito', emoji: '🐴', acao: 'Resolver a palavra do dia', ver: 'Mostrar a palavra do dia', url: '/jogos/dito/' },
    { id: 'soletra', nome: 'Soletra', emoji: '🔤', acao: 'Digitar as palavras', ver: 'Mostrar as palavras', url: '/jogos/soletra/' },
    { id: 'combinado', nome: 'Combinado', emoji: '🧩', acao: 'Resolver os 4 grupos', ver: 'Mostrar os grupos', url: '/jogos/combinado/' },
    { id: 'labirinto', nome: 'Labirinto', emoji: '🌀', acao: 'Mostrar o caminho (você traça)', ver: 'Mostrar o caminho', url: '/jogos/labirinto/' },
    { id: 'wordsearch', nome: 'Caça-Palavras', emoji: '🔎', acao: 'Destacar as palavras', ver: 'Destacar as palavras', url: '/jogos/caca-palavras/' },
    { id: 'crossword', nome: 'Cruzadas', emoji: '⬜', acao: 'Preencher o tabuleiro', ver: 'Mostrar as letras', url: '/jogos/palavras-cruzadas/' },
    { id: 'g1', nome: 'Sudoku (G1)', emoji: '🔢', acao: 'Resolver e preencher', ver: 'Mostrar os números', url: '/jogos/sudoku/' }
  ];

  const MODOS_ACAO = {
    assistido: 'a solução aparece, quem joga é você',
    automatico: 'o helper joga por você'
  };

  // o Sudoku.com NÃO entra: o preenchimento dele depende de input real
  // (chrome.debugger), que não existe em userscript.

  const CORES = {
    dito: '#4FC3F7', soletra: '#FFD54F', combinado: '#81C784',
    labirinto: '#FF8A65', wordsearch: '#BA68C8', crossword: '#4DB6AC', g1: '#F06292'
  };

  const RITMOS = {
    humano: { human: true, speed: 1, nota: 'pausas e movimento naturais' },
    normal: { human: true, speed: 1.8, nota: 'mais rápido' },
    rapido: { human: false, speed: 3, nota: 'sem pausas' }
  };

  UI.modo = 'humano';          // ritmo (só importa no modo automático)
  UI.modoAcao = 'assistido';   // assistido = só mostra | automatico = joga
  UI.jogo = null;
  UI.detectado = null;

  // ── persistência (GM_* quando existir, senão localStorage) ─────────────────

  function ler(chave, padrao) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(chave, padrao);
      const v = localStorage.getItem(chave);
      return v == null ? padrao : v;
    } catch (e) { return padrao; }
  }

  function gravar(chave, valor) {
    try {
      if (typeof GM_setValue === 'function') { GM_setValue(chave, valor); return; }
      localStorage.setItem(chave, String(valor));
    } catch (e) { /* modo privado bloqueia */ }
  }

  // ── CSS ────────────────────────────────────────────────────────────────────

  function injetarCss() {
    if (document.getElementById(ID_CSS)) return;
    const s = document.createElement('style');
    s.id = ID_CSS;
    s.textContent = `
#${ID_BTN}{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:46px;height:46px;
  border-radius:50%;border:1px solid rgba(255,255,255,.14);cursor:pointer;font-size:21px;
  background:#171923;color:#fff;box-shadow:0 8px 26px rgba(0,0,0,.45);display:flex;
  align-items:center;justify-content:center;transition:transform .15s,background .15s}
#${ID_BTN}:hover{transform:scale(1.06)}
#${ID_BTN}.on{background:#4ecdc4;color:#06231f}
#${ID_CARD}{position:fixed;right:16px;bottom:72px;z-index:2147483647;width:300px;
  max-height:76vh;overflow:auto;background:#12141d;color:#e9ebf2;border-radius:14px;
  border:1px solid rgba(255,255,255,.10);box-shadow:0 14px 40px rgba(0,0,0,.55);
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:13px}
#${ID_CARD}[hidden]{display:none}
#${ID_CARD} .h{display:flex;align-items:center;gap:8px;margin-bottom:9px}
#${ID_CARD} .h b{flex:1;font-size:13.5px}
#${ID_CARD} .h small{opacity:.55;font-size:10.5px}
#${ID_CARD} .x{all:unset;cursor:pointer;opacity:.7;padding:0 3px}
#${ID_CARD} .pt{width:9px;height:9px;border-radius:50%;background:#8b93a7;flex:0 0 9px}
#${ID_CARD} .info{font-size:11.5px;color:#8b93a7;margin-bottom:9px}
#${ID_CARD} .acao{width:100%;padding:10px;border:none;border-radius:9px;cursor:pointer;
  font:600 13px/1 inherit;background:#4ecdc4;color:#06231f}
#${ID_CARD} .acao:disabled{opacity:.45;cursor:not-allowed}
#${ID_CARD} .sec{margin-top:11px}
#${ID_CARD} .t{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#8b93a7;
  display:flex;justify-content:space-between;margin-bottom:6px}
#${ID_CARD} .seg{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;background:#171923;
  border:1px solid rgba(255,255,255,.09);border-radius:9px;padding:4px}
#${ID_CARD} .seg button{padding:7px 4px;border:none;border-radius:6px;cursor:pointer;
  background:transparent;color:#8b93a7;font:600 11.5px/1 inherit}
#${ID_CARD} .seg button.on{background:#4ecdc4;color:#06231f}
#${ID_CARD} .chips{display:grid;grid-template-columns:1fr 1fr;gap:5px}
#${ID_CARD} .chip{display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:8px;
  cursor:pointer;text-align:left;background:#171923;border:1px solid rgba(255,255,255,.09);
  color:#e9ebf2;font:500 11.5px/1.2 inherit}
#${ID_CARD} .chip:hover{border-color:rgba(78,205,196,.55)}
#${ID_CARD} .chip.on{border-color:#4ecdc4;background:rgba(78,205,196,.10)}
#${ID_CARD} .log{margin-top:10px;font-size:11px;color:#8b93a7;background:#171923;
  border:1px solid rgba(255,255,255,.09);border-radius:9px;padding:8px 10px;word-break:break-word}
#${ID_CARD} .log:empty{display:none}
#${ID_CARD} .aviso{margin-top:9px;font-size:11px;color:#ffcf8b;background:rgba(255,180,80,.10);
  border:1px solid rgba(255,180,80,.35);border-radius:8px;padding:7px 9px}
#${ID_CARD} .aviso[hidden]{display:none}
`;
    (document.head || document.documentElement).appendChild(s);
  }

  // ── o cartão ───────────────────────────────────────────────────────────────

  function el(tag, css) { const e = document.createElement(tag); if (css) e.style.cssText = css; return e; }

  function montar() {
    injetarCss();

    if (!document.getElementById(ID_BTN)) {
      const b = el('button');
      b.id = ID_BTN;
      b.title = 'G1 Games Helper';
      b.textContent = '🧩';
      b.onclick = () => UI.alternar();
      document.body.appendChild(b);
    }

    if (!document.getElementById(ID_CARD)) {
      const c = el('div');
      c.id = ID_CARD;
      c.hidden = true;
      c.innerHTML = `
        <div class="h"><span class="pt"></span><b id="__g1u_jogo">—</b>
          <small>G1 Helper</small><button class="x" id="__g1u_fechar">✕</button></div>
        <div class="info" id="__g1u_info"></div>
        <div class="t" style="margin-top:2px"><span>Como age</span><small id="__g1u_acao_nota"></small></div>
        <div class="seg" id="__g1u_acoes" style="margin-bottom:9px">
          <button data-acao="assistido">Só mostrar</button>
          <button data-acao="automatico">Resolver</button>
        </div>
        <button class="acao" id="__g1u_acao" disabled>—</button>
        <div class="aviso" id="__g1u_aviso" hidden></div>
        <div class="sec">
          <div class="t"><span>Ritmo</span><small id="__g1u_nota"></small></div>
          <div class="seg" id="__g1u_seg">
            <button data-modo="humano">Humano</button>
            <button data-modo="normal">Normal</button>
            <button data-modo="rapido">Rápido</button>
          </div>
        </div>
        <div class="sec">
          <div class="t"><span>Jogos</span><small>clique para abrir</small></div>
          <div class="chips" id="__g1u_chips"></div>
        </div>
        <div class="log" id="__g1u_log"></div>`;
      document.body.appendChild(c);

      c.querySelector('#__g1u_fechar').onclick = () => UI.fechar();
      c.querySelector('#__g1u_acoes').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-acao]');
        if (!b) return;
        UI.modoAcao = b.dataset.acao;
        gravar(CHAVE_ACAO, UI.modoAcao);
        UI.pintarAcao();
      });
      c.querySelector('#__g1u_seg').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-modo]');
        if (!b) return;
        UI.modo = b.dataset.modo;
        gravar(CHAVE_RITMO, UI.modo);
        UI.pintarRitmo();
      });
      c.querySelector('#__g1u_chips').addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        const j = JOGOS.find(x => x.id === b.dataset.id);
        if (j) window.open(j.url, '_blank');
      });
      c.querySelector('#__g1u_acao').onclick = () => UI.executar();
    }

    UI.pintarRitmo();
    UI.pintarChips();
  }

  /** Reflete o modo de ação escolhido (só mostrar x resolver). */
  UI.pintarAcao = function () {
    const card = document.getElementById(ID_CARD);
    if (!card) return;
    [...card.querySelectorAll('#__g1u_acoes button')].forEach(b => {
      b.classList.toggle('on', b.dataset.acao === UI.modoAcao);
    });
    const n = card.querySelector('#__g1u_acao_nota');
    if (n) n.textContent = MODOS_ACAO[UI.modoAcao] || '';
    // o ritmo só faz diferença quando o helper joga
    const blocoRitmo = card.querySelector('#__g1u_seg');
    if (blocoRitmo) blocoRitmo.parentElement.style.opacity = UI.modoAcao === 'assistido' ? '.45' : '1';
    UI.pintarBotao();
  };

  /** Rótulo do botão principal: muda com o jogo E com o modo de ação. */
  UI.pintarBotao = function () {
    const acaoEl = document.getElementById('__g1u_acao');
    if (!acaoEl) return;
    if (!UI.jogo) { acaoEl.textContent = 'Abra um jogo do G1'; acaoEl.disabled = true; return; }
    const assistido = UI.modoAcao === 'assistido' && UI.jogo.ver;
    acaoEl.textContent = assistido ? UI.jogo.ver : UI.jogo.acao;
    acaoEl.disabled = false;
  };

  UI.pintarRitmo = function () {
    const card = document.getElementById(ID_CARD);
    if (!card) return;
    [...card.querySelectorAll('#__g1u_seg button')].forEach(b => {
      b.classList.toggle('on', b.dataset.modo === UI.modo);
    });
    const n = card.querySelector('#__g1u_nota');
    if (n) n.textContent = (RITMOS[UI.modo] || RITMOS.humano).nota;
  };

  UI.pintarChips = function () {
    const box = document.getElementById('__g1u_chips');
    if (!box) return;
    box.innerHTML = JOGOS.map(j =>
      `<button class="chip${UI.jogo && UI.jogo.id === j.id ? ' on' : ''}" data-id="${j.id}">
         <span>${j.emoji}</span><span>${j.nome}</span></button>`).join('');
  };

  UI.log = function (t) {
    const l = document.getElementById('__g1u_log');
    if (l) l.textContent = t || '';
  };

  UI.aviso = function (t) {
    const a = document.getElementById('__g1u_aviso');
    if (!a) return;
    a.hidden = !t;
    a.textContent = t || '';
  };

  UI.abrir = function () {
    const c = document.getElementById(ID_CARD);
    const b = document.getElementById(ID_BTN);
    if (c) c.hidden = false;
    if (b) b.classList.add('on');
    UI.detectar();
  };

  UI.fechar = function () {
    const c = document.getElementById(ID_CARD);
    const b = document.getElementById(ID_BTN);
    if (c) c.hidden = true;
    if (b) b.classList.remove('on');
  };

  UI.alternar = function () {
    const c = document.getElementById(ID_CARD);
    if (c && c.hidden) UI.abrir(); else UI.fechar();
  };

  // ── detecção na página ─────────────────────────────────────────────────────

  UI.textoInfo = function (res) {
    const i = (res && res.info) || {};
    switch (res && res.strategy) {
      case 'dito': return `${i.linhas || 6} linhas · 5 letras · 6 tentativas`;
      case 'soletra': return `letras ${i.letras || '?'} · ${i.achadas != null ? i.achadas + '/' + i.total : '?'} palavras`;
      case 'combinado': return `${i.palavras || 16} palavras · ${i.gruposResolvidos || 0}/4 grupos`;
      case 'labirinto': return `canvas ${i.canvas ? i.canvas.w + '×' + i.canvas.h : ''} · 7×7`;
      case 'wordsearch': return `${i.grade || ''} · ${i.celulas || 0} células`;
      case 'crossword': return 'grade de cruzadas';
      case 'g1': return `${res.filled} fixas · ${res.empty} vazias`;
      default: return '';
    }
  };

  UI.aplicar = function (res) {
    UI.detectado = res;
    const card = document.getElementById(ID_CARD);
    if (!card) return false;
    const pt = card.querySelector('.pt'), jogoEl = card.querySelector('#__g1u_jogo'),
          infoEl = card.querySelector('#__g1u_info'), acaoEl = card.querySelector('#__g1u_acao');

    if (res && res.found) {
      UI.jogo = JOGOS.find(j => j.id === res.strategy) || { id: res.strategy, nome: res.strategy, emoji: '🎮', acao: 'Resolver' };
      pt.style.background = '#57d97f';
      jogoEl.textContent = UI.jogo.emoji + ' ' + UI.jogo.nome;
      infoEl.textContent = UI.textoInfo(res);
      UI.pintarBotao();
      UI.aviso(res.strategy === 'labirinto'
        ? 'Nesta versão (userscript) não existe input real: o caminho é mostrado e você traça com o mouse.'
        : '');
      UI.log('');
    } else {
      UI.jogo = null;
      pt.style.background = '#8b93a7';
      jogoEl.textContent = 'Nenhum jogo do G1 aqui';
      infoEl.textContent = '';
      acaoEl.disabled = true;
      acaoEl.textContent = 'Abra um jogo do G1';
      UI.log('Use os atalhos abaixo para abrir um jogo.');
    }
    UI.pintarChips();
    return !!(res && res.found);
  };

  UI.detectar = async function (opts) {
    if (typeof window.__g1Helper === 'undefined') return false;
    if (!(opts && opts.silencioso)) UI.log('detectando…');
    try {
      const res = await window.__g1Helper.actionDetect();
      return UI.aplicar(res);
    } catch (e) {
      UI.log('erro na detecção: ' + (e && e.message ? e.message : e));
      return false;
    }
  };

  // ── executar a ação do jogo ────────────────────────────────────────────────

  UI.executar = async function () {
    if (!UI.jogo) return;
    const acaoEl = document.getElementById('__g1u_acao');
    const opts = RITMOS[UI.modo] || RITMOS.humano;
    acaoEl.disabled = true;
    UI.log('trabalhando… (ritmo ' + UI.modo + ')');

    try {
      // ── MODO ASSISTIDO: pinta a solução na página e para por aí ────────────
      if (UI.modoAcao === 'assistido' && UI.jogo.ver) {
        if (typeof revelarJogo !== 'function') { UI.log('módulo assistido ausente'); return; }
        const r = await revelarJogo(UI.detectado, opts);
        if (!r || !r.ok) { UI.log('não consegui mostrar: ' + ((r && (r.erro || r.reason)) || '?')); return; }
        const partes = [];
        if (r.palavra) partes.push('palavra: ' + r.palavra);
        if (r.palavras) partes.push(r.palavras + ' palavras');
        if (r.grupos) partes.push(r.grupos + ' grupos');
        if (r.pintadas) partes.push(r.pintadas + ' marcas na página');
        if (r.casas) partes.push(r.casas + ' casas no trajeto');
        if (r.marcadas) partes.push(r.marcadas + ' células destacadas');
        UI.log((partes.join(' · ') || 'pronto') + ' — agora é com você. Veja o painel na página.');
        return;
      }

      // O Labirinto não aceita input sintético: aqui só mostramos o caminho.
      if (UI.jogo.id === 'labirinto') {
        if (typeof labirintoPainel === 'function') await labirintoPainel('siga as setas com o mouse');
        UI.log('trajeto no painel à direita. Comece na letra inicial e siga as setas.');
        return;
      }

      const r = await window.__g1Helper.actionAuto(opts);
      if (!r) { UI.log('sem resposta da página'); return; }
      if (r.error) { UI.log('erro: ' + r.error); return; }

      if (r.success) {
        const partes = [];
        if (r.palavras) partes.push(r.palavras + ' palavras');
        if (r.marcadas) partes.push(r.marcadas + ' células destacadas');
        if (r.filled) partes.push(r.filled + ' células preenchidas');
        if (r.palavra) partes.push('palavra: ' + r.palavra);
        if (r.placar) partes.push('placar ' + r.placar);
        if (r.pontosAprox) partes.push('~' + r.pontosAprox + ' pts');
        if (r.gruposResolvidos != null) partes.push(r.gruposResolvidos + '/4 grupos');
        if (r.jaResolvido) partes.push('já estava resolvido hoje');
        // a re-detecção é só para atualizar a métrica do card — se ela escrever
        // "detectando…" no log, o usuário nunca lê o resultado (bug real)
        await UI.detectar({ silencioso: true });
        UI.log(partes.join(' · ') || 'concluído');
      } else {
        UI.log((r.reason || r.erro || 'não consegui concluir') +
               ' — veja o painel na página para o detalhe.');
      }
    } catch (e) {
      UI.log('erro: ' + (e && e.message ? e.message : e));
    } finally {
      acaoEl.disabled = false;
    }
  };

  // ── atalhos no menu do gerenciador (quando existir) ────────────────────────

  UI.registrarMenu = function () {
    if (typeof GM_registerMenuCommand !== 'function') return;
    try {
      GM_registerMenuCommand('🧩 Abrir o menu do helper', UI.abrir);
      GM_registerMenuCommand('👀 Modo: só mostrar a solução', () => {
        UI.modoAcao = 'assistido'; gravar(CHAVE_ACAO, 'assistido'); UI.pintarAcao(); UI.abrir();
      });
      GM_registerMenuCommand('🤖 Modo: resolver por mim', () => {
        UI.modoAcao = 'automatico'; gravar(CHAVE_ACAO, 'automatico'); UI.pintarAcao(); UI.abrir();
      });
      GM_registerMenuCommand('▶️ Resolver o jogo desta página', () => { UI.abrir(); UI.executar(); });
      GM_registerMenuCommand('🎚️ Ritmo: Humano', () => { UI.modo = 'humano'; gravar(CHAVE_RITMO, 'humano'); UI.pintarRitmo(); });
      GM_registerMenuCommand('🎚️ Ritmo: Normal', () => { UI.modo = 'normal'; gravar(CHAVE_RITMO, 'normal'); UI.pintarRitmo(); });
      GM_registerMenuCommand('🎚️ Ritmo: Rápido', () => { UI.modo = 'rapido'; gravar(CHAVE_RITMO, 'rapido'); UI.pintarRitmo(); });
      GM_registerMenuCommand('🧹 Fechar o painel da página', () => {
        if (typeof gcPainelFechar === 'function') gcPainelFechar();
      });
    } catch (e) { /* gerenciador sem suporte */ }
  };

  UI.iniciar = function () {
    UI.modo = String(ler(CHAVE_RITMO, 'humano') || 'humano');
    if (!RITMOS[UI.modo]) UI.modo = 'humano';
    UI.modoAcao = String(ler(CHAVE_ACAO, 'assistido') || 'assistido');
    if (!MODOS_ACAO[UI.modoAcao]) UI.modoAcao = 'assistido';
    montar();
    UI.pintarAcao();
    UI.registrarMenu();
    // se já estiver numa página de jogo, deixa o botão pulsando para chamar atenção
    UI.detectar().then(ok => {
      const b = document.getElementById(ID_BTN);
      if (b && ok) b.title = 'G1 Games Helper — ' + (UI.jogo ? UI.jogo.nome : 'jogo detectado') + ' (clique)';
    });
  };

  window.__g1UI = UI;
  window.g1uiIniciar = UI.iniciar;
})();


  // ── arranque ───────────────────────────────────────────────────────────────
  // O menu da página só faz sentido nas páginas de jogo; o @match já limita,
  // mas checar aqui deixa o arquivo seguro se for injetado à mão em outro lugar.
  function arrancar() {
    if (!/\/jogos\//.test(location.pathname)) return;
    if (typeof window.g1uiIniciar !== 'function') return;
    window.g1uiIniciar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(arrancar, 300));
  } else {
    setTimeout(arrancar, 300);
  }
})();
