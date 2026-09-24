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

  const JOGOS = [
    { id: 'dito', nome: 'Dito', emoji: '🐴', acao: 'Resolver a palavra do dia', url: '/jogos/dito/' },
    { id: 'soletra', nome: 'Soletra', emoji: '🔤', acao: 'Digitar as palavras', url: '/jogos/soletra/' },
    { id: 'combinado', nome: 'Combinado', emoji: '🧩', acao: 'Resolver os 4 grupos', url: '/jogos/combinado/' },
    { id: 'labirinto', nome: 'Labirinto', emoji: '🌀', acao: 'Mostrar o caminho (você traça)', url: '/jogos/labirinto/' },
    { id: 'wordsearch', nome: 'Caça-Palavras', emoji: '🔎', acao: 'Destacar as palavras', url: '/jogos/caca-palavras/' },
    { id: 'crossword', nome: 'Cruzadas', emoji: '⬜', acao: 'Preencher o tabuleiro', url: '/jogos/palavras-cruzadas/' },
    { id: 'g1', nome: 'Sudoku (G1)', emoji: '🔢', acao: 'Resolver e preencher', url: '/jogos/sudoku/' }
  ];

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

  UI.modo = 'humano';
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
      acaoEl.disabled = false;
      acaoEl.textContent = UI.jogo.acao;
      UI.aviso(res.strategy === 'labirinto'
        ? 'Nesta versão (userscript) não existe input real: o caminho é mostrado no painel e você traça com o mouse.'
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
    montar();
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
