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
