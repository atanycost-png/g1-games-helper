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
