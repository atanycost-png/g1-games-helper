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

  /** Insere um fantasma dentro de `pai`, posicionado de forma absoluta. */
  function fantasmaDiv(pai, texto, escala) {
    if (!pai) return null;
    if (getComputedStyle(pai).position === 'static') pai.style.position = 'relative';
    const s = document.createElement('span');
    s.className = CLASSE;
    s.textContent = texto;
    s.style.cssText = [
      'position:absolute', 'inset:0', 'display:flex', 'align-items:center',
      'justify-content:center', 'pointer-events:none', 'z-index:5',
      'color:' + COR, 'font-weight:700',
      'font-size:' + (escala || '62%'), 'opacity:.72',
      'line-height:1', 'font-family:inherit'
    ].join(';');
    pai.appendChild(s);
    return s;
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
      // clona o .cell-text do site: a geometria e o alinhamento vêm prontos
      const alvo = (cell.click.closest ? cell.click.closest('.cell') : null) || cell.click.parentElement;
      const base = (alvo && alvo.querySelector('.cell-text')) || (alvo && alvo.querySelector('SPAN'));
      const el = fantasmaDiv(alvo, String(quer), '58%');
      if (el) pintadas++;
      void base;
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
        if (r.palavra[i] && fantasmaDiv(casa, r.palavra[i], '64%')) pintadas++;
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
