/**
 * G1 Games Helper — Popup (o "menu")
 * ==================================
 * Mostra o jogo da aba atual num card, com UM botão de ação que já resolve, e
 * lista todos os jogos suportados como chips (clicar abre o jogo).
 *
 * Três caminhos de execução:
 *  1. DOM  — o content script resolve (dito, soletra, combinado, cruzadas,
 *            caça-palavras, sudoku do G1);
 *  2. CDP  — jogos de canvas que ignoram evento sintético: o plano vai para o
 *            background (chrome.debugger → input real). sudoku.com = cliques,
 *            labirinto = arrasto;
 *  3. Modo humanizado em TODOS: o ritmo (Humano/Normal/Rápido) é aplicado tanto
 *     no content script (pausas entre letras/cliques) quanto no executor CDP
 *     (movimento interpolado do mouse).
 */

const MODOS = {
  humano: { human: true, speed: 1 },
  normal: { human: true, speed: 1.8 },
  rapido: { human: false, speed: 3 }
};

/** Menu de jogos: id = estratégia devolvida pelo content script. */
const JOGOS = [
  { id: 'dito',         nome: 'Dito',            emoji: '🐴', url: 'https://g1.globo.com/jogos/dito/',              acao: 'Resolver a palavra do dia',  ver: 'Mostrar a palavra do dia' },
  { id: 'soletra',      nome: 'Soletra',         emoji: '🔤', url: 'https://g1.globo.com/jogos/soletra/',           acao: 'Digitar as palavras',        ver: 'Mostrar as palavras' },
  { id: 'combinado',    nome: 'Combinado',       emoji: '🧩', url: 'https://g1.globo.com/jogos/combinado/',         acao: 'Resolver os 4 grupos',       ver: 'Mostrar os grupos' },
  { id: 'labirinto',    nome: 'Labirinto',       emoji: '🌀', url: 'https://g1.globo.com/jogos/labirinto/',         acao: 'Traçar o caminho',           ver: 'Mostrar o caminho' },
  { id: 'wordsearch',   nome: 'Caça-Palavras',   emoji: '🔎', url: 'https://g1.globo.com/jogos/caca-palavras/',     acao: 'Destacar as palavras',       ver: 'Destacar as palavras' },
  { id: 'crossword',    nome: 'Cruzadas',        emoji: '⬜', url: 'https://g1.globo.com/jogos/palavras-cruzadas/', acao: 'Preencher o tabuleiro',      ver: 'Mostrar as letras' },
  { id: 'g1',           nome: 'Sudoku (G1)',     emoji: '🔢', url: 'https://g1.globo.com/jogos/sudoku/',            acao: 'Resolver e preencher',       ver: 'Mostrar os números' },
/* @loja:remove:start — sudoku.com fica fora do pacote de loja (host restrito a g1.globo.com) */
  { id: 'sudoku.com',   nome: 'Sudoku.com',      emoji: '🌐', url: 'https://sudoku.com/br/facil/',                  acao: 'Preencher o tabuleiro',      ver: null },
/* @loja:remove:end */
  { id: 'table',        nome: 'Grade HTML',      emoji: '📋', url: 'https://g1.globo.com/jogos/soletra/',           acao: 'Resolver e preencher',       ver: 'Mostrar os números' },
  { id: 'inputs',       nome: 'Formulário 9×9',  emoji: '⌨️', url: 'https://g1.globo.com/jogos/sudoku/',            acao: 'Resolver e preencher',       ver: 'Mostrar os números' }
];

const MODOS_ACAO = {
  assistido: { nota: 'a solução aparece, quem joga é você' },
  automatico: { nota: 'o helper joga por você' }
};

const MSG = {
  G1_LOGIN_REQUIRED: 'O G1 exige LOGIN para liberar o jogo. Faça login em g1.globo.com e recarregue a página.',
  G1_BOARD_NOT_STARTED: 'Escolha uma dificuldade na página para gerar o tabuleiro.',
  SUDOKUCOM_NO_CANVAS: 'Não encontrei o canvas do jogo no sudoku.com.',
  SUDOKUCOM_BOARD_NOT_STARTED: 'O jogo do sudoku.com ainda não começou. Inicie um nível e tente de novo.'
};

document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const sub = $('sub'), ponto = $('ponto'), jogoEl = $('jogo'), badge = $('badge'),
        infoEl = $('info'), acaoEl = $('acao'), chipsEl = $('chips'), logEl = $('log'),
        ritmoNota = $('ritmo-nota'), fecharEl = $('fechar-popup'),
        acoesEl = $('acoes'), acaoNota = $('acao-nota');

  let jogo = null;        // { id, nome, emoji, acao, ver, ... } do jogo detectado
  let detectado = null;   // resposta crua do content script
  let modo = 'humano';    // ritmo (só faz diferença no modo automático)
  let modoAcao = 'assistido';   // assistido = só mostra | automatico = joga

  const log = (t) => { logEl.textContent = t || ''; };

  // ── persistência do ritmo ──────────────────────────────────────────────────
  // ⚠️ `chrome.storage` exige a permissão "storage" no manifest. Se ela faltar,
  // o objeto nem existe e um acesso direto derruba TODO o DOMContentLoaded
  // (o popup abria sem botões). Aqui a falha é tolerada.
  const store = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  if (store) {
    store.get(['modo', 'fechar', 'modoAcao'], (r) => {
      if (r && r.modo && MODOS[r.modo]) modo = r.modo;
      if (r && typeof r.fechar === 'boolean') fecharEl.checked = r.fechar;
      if (r && r.modoAcao && MODOS_ACAO[r.modoAcao]) modoAcao = r.modoAcao;
      pintarRitmo(); pintarAcao();
    });
  } else {
    pintarRitmo(); pintarAcao();
  }

  /** Mostra quem escolheu: "só mostrar" (assistido) ou "resolver" (automático). */
  function pintarAcao() {
    [...acoesEl.children].forEach(b => b.classList.toggle('on', b.dataset.acao === modoAcao));
    acaoNota.textContent = (MODOS_ACAO[modoAcao] || {}).nota || '';
    // o ritmo só existe no modo automático — no assistido nada é digitado
    ritmoNota.parentElement.style.opacity = modoAcao === 'assistido' ? '.45' : '1';
    pintarBotao();
  }

  /** Rótulo do botão principal muda conforme o jogo e o modo de ação. */
  function pintarBotao() {
    if (!jogo) { acaoEl.textContent = 'Abra um jogo do G1'; return; }
    const assistido = modoAcao === 'assistido' && jogo.ver;
    acaoEl.textContent = assistido ? jogo.ver : jogo.acao;
    acaoEl.disabled = !(assistido || modoAcao === 'automatico');
  }

  acoesEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-acao]');
    if (!b) return;
    modoAcao = b.dataset.acao;
    pintarAcao();
    if (store) store.set({ modoAcao });
  });

  function pintarRitmo() {
    [...$('ritmos').children].forEach(b => b.classList.toggle('on', b.dataset.modo === modo));
    ritmoNota.textContent = modo === 'humano' ? 'pausas e movimento naturais'
      : modo === 'normal' ? 'mais rápido' : 'sem pausas';
  }

  $('ritmos').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-modo]');
    if (!b) return;
    modo = b.dataset.modo;
    pintarRitmo();
    if (store) store.set({ modo });
  });
  fecharEl.addEventListener('change', () => { if (store) store.set({ fechar: fecharEl.checked }); });

  // ── chips (menu de jogos) ──────────────────────────────────────────────────
  function pintarChips() {
    chipsEl.replaceChildren();
    for (const j of JOGOS) {
      const b = document.createElement('button');
      b.className = 'chip' + (jogo && jogo.id === j.id ? ' on' : '');
      b.dataset.id = j.id;
      b.title = j.acao;
      const emoji = document.createElement('span');
      emoji.className = 'chip-emoji';
      emoji.textContent = j.emoji;
      const nome = document.createElement('span');
      nome.textContent = j.nome;
      b.append(emoji, nome);
      chipsEl.appendChild(b);
    }
  }
  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const j = JOGOS.find(x => x.id === b.dataset.id);
    if (j) chrome.tabs.create({ url: j.url });
  });

  // ── ponte com a página ─────────────────────────────────────────────────────
  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function garantirContent() {
    const tab = await activeTab();
    if (!tab) return null;
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      if (pong && pong.ok) return tab;
    } catch (e) { /* ainda não injetado */ }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['solver.js', 'crossword.js', 'wordsearch.js', 'g1common.js',
                'dito.js', 'soletra.js', 'combinado.js', 'labirinto.js', 'revelar.js', 'content.js']
      });
      await new Promise(r => setTimeout(r, 320));
      const pong = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      return (pong && pong.ok) ? tab : null;
    } catch (e) {
      return null;
    }
  }

  async function send(message) {
    const tab = await garantirContent();
    if (!tab) { log('Não consigo falar com a página. Recarregue a aba (F5).'); return null; }
    try { return await chrome.tabs.sendMessage(tab.id, message); }
    catch (e) { log('Erro ao falar com a página: ' + e.message); return null; }
  }

  // ── card do jogo ───────────────────────────────────────────────────────────
  function jogoPorEstrategia(est) {
    return JOGOS.find(j => j.id === est) ||
      (/cruzada/.test(est || '') ? JOGOS.find(j => j.id === 'crossword') : null);
  }

  function textoInfo(res) {
    const i = res.info || {};
    switch (res.strategy) {
      case 'dito': return `${i.linhas || 6} linhas · 5 letras · 6 tentativas`;
      case 'soletra': return `letras ${i.letras || '?'} · ${i.achadas != null ? i.achadas + '/' + i.total : '?'} palavras`;
      case 'combinado': return `${i.palavras || 16} palavras · ${i.gruposResolvidos || 0}/4 grupos`;
      case 'labirinto': return `canvas ${i.canvas ? i.canvas.w + '×' + i.canvas.h : ''} · grade 7×7`;
      case 'wordsearch': return `${i.grade || ''} · ${i.celulas || 0} células`;
      case 'crossword': return `grade de cruzadas · ${i.preenchidas != null ? i.preenchidas : '?'} células`;
      case 'sudoku.com': return `canvas · gabarito disponível`;
      default: return (res.filled != null) ? `${res.filled} fixas · ${res.empty} vazias` : '';
    }
  }

  function aplicarDetect(res) {
    detectado = res;
    if (!res) { sub.textContent = 'sem resposta da página'; return false; }
    if (res.error) { sub.textContent = 'erro: ' + res.error; log(String(res.error)); return false; }

    if (res.found) {
      jogo = jogoPorEstrategia(res.strategy) || { id: res.strategy, nome: res.strategy, emoji: '🎮', acao: 'Resolver' };
      ponto.style.background = 'var(--ok)';
      jogoEl.textContent = jogo.emoji + ' ' + jogo.nome;
      badge.textContent = res.strategy;
      badge.className = 'badge on';
      infoEl.textContent = textoInfo(res);
      pintarBotao();
      sub.textContent = 'jogo detectado';
      log('');
    } else {
      jogo = null;
      ponto.style.background = 'var(--muted)';
      jogoEl.textContent = 'Nenhum jogo aqui';
      badge.textContent = '—';
      badge.className = 'badge';
      infoEl.textContent = '';
      pintarBotao();
      sub.textContent = 'nada detectado nesta aba';
      const issue = res.diag && res.diag.issues && res.diag.issues[0];
      log(MSG[issue] || 'Dica: abra um dos jogos do menu abaixo.');
    }
    pintarChips();
    return !!res.found;
  }

  async function detectar() {
    sub.textContent = 'detectando…';
    const res = await send({ action: 'detect' });
    return aplicarDetect(res);
  }

  // ── execução ───────────────────────────────────────────────────────────────
  function opts() { return MODOS[modo] || MODOS.humano; }

  function fecharSePedido(ms) {
    if (fecharEl && fecharEl.checked) setTimeout(() => window.close(), ms || 400);
  }

/* @loja:remove:start — sem a permissão `debugger` não existe input real:
   o Sudoku.com (canvas, sem DOM de casas) sai do pacote de loja inteiro. */
  /** sudoku.com: plano de cliques + chrome.debugger (input real). */
  async function cdpSudoku(optsMenu) {
    const sol = await send({ action: 'solve' });
    if (!sol || !sol.solvable) { log((sol && sol.reason) || 'não consegui resolver'); return; }
    const planRes = await send({ action: 'plan', solution: sol.solution });
    if (!planRes || !planRes.success) { log('sem plano de cliques: ' + ((planRes && planRes.reason) || '?')); return; }
    const total = planRes.plan.cells.length;
    if (!total) { sub.textContent = 'o tabuleiro já está completo'; return; }

    const tab = await activeTab();
    const payload = { type: 'cdpFill', tabId: tab.id, plan: planRes.plan, opts: optsMenu };
    if (fecharEl.checked) {
      chrome.runtime.sendMessage(payload).catch(() => {});
      sub.textContent = `preenchendo ${total} células — acompanhe na página`;
      fecharSePedido(300);
      return;
    }
    const r = await chrome.runtime.sendMessage(payload);
    sub.textContent = r && r.success ? `${r.done}/${r.total} células` : 'falhou: ' + ((r && r.error) || '?');
  }

/* @loja:remove:end */

  /** labirinto: tenta sintético; se o jogo não aceitar, arrasto real por CDP. */
  async function labirinto(optsMenu) {
    log('montando o trajeto…');
    const r = await send({ action: 'fill', opts: optsMenu });
    if (!r) return;
    if (r.success && r.palavra) { sub.textContent = 'trajeto aplicado'; log('palavra: ' + r.palavra); return; }
    if (r.precisaCdp && r.plano) {
/* @loja:remove:start — o arrasto real (CDP) só existe no build completo */
      const tab = await activeTab();
      const payload = { type: 'cdpDrag', tabId: tab.id, plan: r.plano, opts: optsMenu };
      if (fecharEl.checked) {
        chrome.runtime.sendMessage(payload).catch(() => {});
        sub.textContent = 'traçando o caminho — acompanhe na página';
        fecharSePedido(300);
        return;
      }
      const res = await chrome.runtime.sendMessage(payload);
      sub.textContent = res && res.success ? 'trajeto traçado' : 'falhou: ' + ((res && res.error) || '?');
      return;
/* @loja:remove:end */
      /* build de loja: sem input real, mostra o trajeto e deixa o jogador traçar */
      const rv = await send({ action: 'revelar', opts: optsMenu });
      sub.textContent = rv && rv.ok ? 'trajeto mostrado — trace com o mouse' : 'não consegui mostrar';
      log(rv && rv.ok ? ('palavra: ' + (rv.word || '?') + ' · ' + (rv.casas || 0) + ' casas no trajeto') : 'sem detalhes');
      return;
    }
    sub.textContent = 'não consegui traçar';
    log((r && (r.erro || r.reason)) || 'sem detalhes');
  }

  async function executar() {
    if (!jogo) return;
    acaoEl.disabled = true;

    // ── MODO ASSISTIDO: pinta a solução e para por aí ──────────────────────────
    if (modoAcao === 'assistido' && jogo.ver) {
      log('mostrando a solução (nada é preenchido)…');
      const r = await send({ action: 'revelar', opts: opts() });
      if (!r) { acaoEl.disabled = false; return; }
      if (r.error) { log('erro: ' + r.error); acaoEl.disabled = false; return; }
      if (r.success) {
        const partes = [];
        if (r.palavra) partes.push('palavra: ' + r.palavra);
        if (r.palavras) partes.push(r.palavras + ' palavras');
        if (r.grupos) partes.push(r.grupos + ' grupos');
        if (r.pintadas) partes.push(r.pintadas + ' marcas na página');
        if (r.casas) partes.push(r.casas + ' casas no trajeto');
        if (r.marcadas) partes.push(r.marcadas + ' células destacadas');
        sub.textContent = 'solução na página — você joga';
        log((partes.join(' · ') || 'pronto') + ' · veja o painel na página');
        if (fecharEl.checked) setTimeout(() => window.close(), 1100);
      } else {
        sub.textContent = 'não consegui mostrar';
        log((r.reason || r.erro || 'sem detalhes') + ' — o painel na página explica.');
      }
      acaoEl.disabled = false;
      return;
    }

    log('trabalhando… (modo ' + modo + ')');
    try {
/* @loja:remove:start */
      if (jogo.id === 'sudoku.com') { await cdpSudoku(opts()); return; }
/* @loja:remove:end */
      if (jogo.id === 'labirinto') { await labirinto(opts()); return; }

      const r = await send({ action: 'auto', opts: opts() });
      if (!r) return;
      if (r.error) { log('erro: ' + r.error); return; }

      if (r.success) {
        const partes = [];
        if (r.palavras) partes.push(r.palavras + ' palavras');
        if (r.marcadas) partes.push(r.marcadas + ' células destacadas');
        if (r.filled) partes.push(r.filled + ' células preenchidas');
        if (r.palavra) partes.push('palavra: ' + r.palavra);
        if (r.placar) partes.push('placar ' + r.placar);
        if (r.pontosAprox) partes.push('~' + r.pontosAprox + ' pts');
        if (r.gruposResolvidos != null) partes.push(r.gruposResolvidos + '/4 grupos');
        if (r.confirmadas != null) partes.push(r.confirmadas + ' confirmadas');
        sub.textContent = partes.join(' · ') || 'concluído';
        if (r.lista) log(r.lista.slice(0, 8).join(' · ') + (r.lista.length > 8 ? ' …' : ''));
        else if (r.detalhes) log(r.detalhes.map(d => d.grupo + (d.ok ? ' ✔' : ' ✗')).join(' · '));
        else log('veja o painel na página (canto direito) para o passo a passo');
        fecharSePedido(1200);
      } else {
        sub.textContent = 'não consegui concluir';
        log((r.reason || r.erro || 'sem detalhes') + ' — o painel na página explica o motivo.');
      }
    } finally {
      acaoEl.disabled = false;
    }
  }

  acaoEl.addEventListener('click', executar);
  $('detectar').addEventListener('click', detectar);
  $('limpar').addEventListener('click', async () => {
    await send({ action: 'limpar-marcas' });
    log('marcas e painel removidos da página');
  });

  // ── ao abrir ───────────────────────────────────────────────────────────────
  pintarChips();
  detectar();
});
