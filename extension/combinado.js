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
