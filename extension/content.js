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
