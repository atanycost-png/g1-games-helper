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
