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
    const mk = (tag, text, css) => {
      const n = document.createElement(tag);
      if (text != null) n.textContent = String(text);
      if (css) n.style.cssText = css;
      return n;
    };

    const cab = mk('div', null, 'display:flex;align-items:center;gap:8px;margin-bottom:8px');
    cab.appendChild(mk('span', null, 'width:9px;height:9px;border-radius:50%;background:' + cor));
    cab.appendChild(mk('b', titulo, 'flex:1;font-size:13.5px'));
    cab.appendChild(mk('span', 'G1 Helper', 'opacity:.65;font-size:11px'));
    const fechar = mk('button', '✕', 'all:unset;cursor:pointer;opacity:.7;padding:0 3px');
    fechar.id = '__g1g_fechar';
    cab.appendChild(fechar);
    el.appendChild(cab);

    if (sub) el.appendChild(mk('div', sub, 'opacity:.78;font-size:12px;margin:-3px 0 9px'));
    for (const s of (secoes || [])) {
      if (s.titulo) el.appendChild(mk('div', s.titulo,
        'font-size:11px;letter-spacing:.04em;text-transform:uppercase;opacity:.55;margin:10px 0 5px'));
      // Nenhum chamador atual usa s.html. Se um módulo futuro precisar de HTML,
      // ele deve construir nós DOM, não reabrir um sink de HTML.
      if (s.html) { el.appendChild(mk('div', s.html)); continue; }
      for (const it of (s.itens || [])) {
        const row = mk('div', null, 'display:flex;align-items:center;gap:7px;margin:3px 0');
        if (it.cor) row.appendChild(mk('span', null,
          'width:10px;height:10px;border-radius:3px;background:' + it.cor + ';flex:0 0 auto'));
        row.appendChild(mk('span', it.txt, 'flex:1'));
        if (it.nota) row.appendChild(mk('span', it.nota, 'opacity:.55;font-size:11px'));
        el.appendChild(row);
      }
    }
    if (rodape) el.appendChild(mk('div', rodape,
      'opacity:.55;font-size:11px;margin-top:10px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px'));
    fechar.onclick = GC.painelFechar;
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
