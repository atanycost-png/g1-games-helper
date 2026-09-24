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

  D.estado = function () {
    const linhas = [...document.querySelectorAll('.board .row')].map(r => ({
      texto: (r.textContent || '').trim(),
      cls: [...r.children].map(c => String(c.className).replace(/svelte-\S+/g, '').trim())
    }));
    const usadas = linhas.filter(l => l.texto).length;
    const acertou = linhas.some(l => l.cls.length && l.cls.every(c => /correct/.test(c)));
    const tela = document.body.innerText.replace(/\s+/g, ' ');
    return {
      linhas: linhas.slice(0, usadas),
      tentativasUsadas: usadas,
      acertou: acertou || /Acertou|Parabéns/i.test(tela),
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

    const st = D.estado();
    if (st.acertou) {
      window.gcPainel('Dito', 'Partida de hoje já resolvida', [
        { titulo: 'Situação', itens: [{ txt: 'Você já acertou a palavra de hoje', nota: st.tentativasUsadas + '/6' }] }
      ], 'Aguarde o próximo desafio (à meia-noite).');
      return { ok: true, jaResolvido: true };
    }

    const r = await D.palavraDeHoje();
    if (r.erro) {
      window.gcPainel('Dito', 'Não consegui ler o gabarito', [
        { titulo: 'Motivo', itens: [{ txt: r.erro }] }
      ], 'Recarregue a página (F5) e tente de novo.');
      return { ok: false, erro: r.erro };
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

    await window.gcSleep(1400);
    const fim = D.estado();

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
