/**
 * G1 Games Helper — background (service worker MV3)
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * O sudoku.com desenha o tabuleiro num <canvas> e IGNORA eventos sintéticos
 * (`canvas.dispatchEvent(new MouseEvent('mousedown', ...))`) — testado:
 * mouseover/mousemove/mousedown/mouseup/click, PointerEvent completo e até
 * `isTrusted` forjado com Object.defineProperty. Nenhum seleciona a célula,
 * então o numpad aplica o número em outra célula (ou em nada) e o jogo fica
 * parado. Só evento de INPUT REAL move o jogo.
 *
 * A única API de extensão que produz input real é `chrome.debugger`
 * (CDP `Input.dispatchMouseEvent`) — é o mesmo caminho que o DevTools usa.
 * Por isso o preenchimento do sudoku.com roda AQUI (service worker), e não no
 * content script: `chrome.debugger` não está disponível em content script.
 *
 * Bônus: como o input é montado passo a passo, este executor já faz o
 * MOVIMENTO DO MOUSE com interpolação e delays aleatórios — o "modo humanizado".
 *
 * O popup manda o plano e fecha: ao fechar, a página recupera o foco e o jogo
 * não fica pausado (o pause-overlay do sudoku.com também bloqueia cliques).
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

// ────────────────────────────────────────────────────────────────────────────
// CDP
// ────────────────────────────────────────────────────────────────────────────

function attach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function detach(tabId) {
  return new Promise(resolve => {
    chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; resolve(); });
  });
}

function cmd(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params === undefined ? {} : params, res => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res);
    });
  });
}

/** Avalia JS na página (para fechar overlays e conferir estado). */
async function evaluate(tabId, expression) {
  const r = await cmd(tabId, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (r && r.exceptionDetails) return null;
  return r && r.result ? r.result.value : null;
}

// ────────────────────────────────────────────────────────────────────────────
// input "humano"
// ────────────────────────────────────────────────────────────────────────────

/**
 * Move o mouse de `from` até `to` em passos, imitando trajetória manual.
 * `speed` > 1 acelera (modo rápido), < 1 desacelera.
 */
async function moveMouse(tabId, from, to, speed, human) {
  if (!human) {
    await cmd(tabId, 'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: to.x, y: to.y, button: 'none', buttons: 0 });
    return;
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(2, Math.min(24, Math.round(dist / 18)));
  for (let i = 1; i <= steps; i++) {
    // easing leve para parecer mais natural que linear puro
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = Math.round(from.x + (to.x - from.x) * e);
    const y = Math.round(from.y + (to.y - from.y) * e);
    await cmd(tabId, 'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(rnd(7, 20) / speed);
  }
}

async function clickAt(tabId, pos, speed, human) {
  await cmd(tabId, 'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(human ? rnd(42, 105) / speed : 12);
  await cmd(tabId, 'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', buttons: 0, clickCount: 1 });
}

/** Teclado (alguns sites aceitam 1-9 direto; usado só no fallback). */
async function typeDigit(tabId, digit, speed) {
  const code = 'Digit' + digit;
  const keyCode = 48 + Number(digit);
  await cmd(tabId, 'Input.dispatchKeyEvent',
    { type: 'keyDown', text: String(digit), key: digit, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await sleep(rnd(20, 45) / speed);
  await cmd(tabId, 'Input.dispatchKeyEvent',
    { type: 'keyUp', key: digit, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
}

// ────────────────────────────────────────────────────────────────────────────
// despausar / limpar overlays
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fecha o banner de cookies e ESCONDE os anúncios. É CARO: esconder o
 * `.ima-container` faz o site recarregar o anúncio, então isto roda no início
 * e só quando um clique for bloqueado — nunca no laço principal.
 */
async function hideBlockers(tabId, plan) {
  return evaluate(tabId, `(() => {
    let n = 0;
    for (const sel of ${JSON.stringify(plan.closeSelectors || [])}) {
      const el = document.querySelector(sel);
      if (el) { el.click(); n++; }
    }
    for (const sel of ${JSON.stringify(plan.hideSelectors || [])}) {
      document.querySelectorAll(sel).forEach(el => {
        el.style.pointerEvents = 'none';
        el.style.display = 'none';
        n++;
      });
    }
    return n;
  })()`);
}

/**
 * Só o overlay de pausa — o único bloqueador que aparece sozinho com o tempo
 * (o sudoku.com pausa quando a janela perde o foco, e o overlay tem
 * `pointer-events: auto`, engolindo todo clique no tabuleiro).
 * BARATO: 1 avaliação quando não há nada bloqueando.
 */
async function clearBlockers(tabId, plan, speed, human) {
  for (let tent = 0; tent < 3; tent++) {
    const pos = await evaluate(tabId, `(() => {
      const po = document.querySelector('#pause-overlay');
      if (!po) return null;
      const s = getComputedStyle(po), b = po.getBoundingClientRect();
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') <= 0.1 || b.width === 0) return null;
      return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) });
    })()`);
    if (!pos) return true;                       // nada bloqueando
    const p = typeof pos === 'string' ? JSON.parse(pos) : pos;
    if (!p) return true;

    await clickAt(tabId, p, speed, human);       // overlay: clique direto basta
    await sleep(400 / speed);
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// executor do plano
// ────────────────────────────────────────────────────────────────────────────

async function runPlan(tabId, plan, opts) {
  const speed = opts.speed || 1;
  const human = opts.human !== false;
  const useKeyboard = !!opts.useKeyboard;

  let pos = { x: Math.max(40, (plan.cells[0] && plan.cells[0].x - 150) || 120), y: 90 };
  let done = 0;
  const errors = [];

  await hideBlockers(tabId, plan);            // uma vez (esconder é caro)
  await clearBlockers(tabId, plan, speed, human);

  for (const cell of plan.cells) {
    // 0) o tabuleiro está mesmo recebendo o clique? (o anúncio volta sempre)
    const hitExpr = `(() => { const el = document.elementFromPoint(${cell.x}, ${cell.y}); return el ? el.tagName : 'null'; })()`;
    let hit = await evaluate(tabId, hitExpr);
    if (hit !== 'CANVAS') {
      await hideBlockers(tabId, plan);         // só aqui: esconder é caro
      await clearBlockers(tabId, plan, speed, human);
      hit = await evaluate(tabId, hitExpr);
      if (hit !== 'CANVAS') {
        errors.push(`célula ${cell.row},${cell.col} bloqueada por ${hit}`);
        done++;
        continue;
      }
    }

    // 1) seleciona a célula no canvas
    await moveMouse(tabId, pos, cell, speed, human);
    await clickAt(tabId, cell, speed, human);
    pos = { x: cell.x, y: cell.y };
    await sleep((human ? rnd(120, 260) : 60) / speed);

    // 2) digita o valor (numpad clicado, ou teclado se pedido)
    if (useKeyboard) {
      await typeDigit(tabId, cell.value, speed);
      pos = { x: cell.x, y: cell.y };
    } else {
      const np = plan.numpad[String(cell.value)];
      if (!np) { errors.push(`sem numpad para ${cell.value}`); continue; }
      await moveMouse(tabId, pos, np, speed, human);
      await clickAt(tabId, np, speed, human);
      pos = { x: np.x, y: np.y };
    }
    await sleep((human ? rnd(140, 320) : 70) / speed);

    done++;

    // o overlay de pausa volta se a janela perder o foco no meio do caminho:
    // re-checa de vez em quando para não travar no meio do preenchimento
    if (done % 8 === 0) await clearBlockers(tabId, plan, speed, human);

    chrome.action.setBadgeText({ tabId, text: `${done}/${plan.cells.length}` }).catch(() => {});
  }

  // limpa o badge
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 4000);
  return { done, total: plan.cells.length, errors };
}

// ────────────────────────────────────────────────────────────────────────────
// arrasto (Labirinto: canvas que só aceita input real)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Arrasta o mouse por uma lista de pontos. O content script já manda o trajeto
 * INTERPOLADO (o Labirinto precisa que cada casa seja visitada: ele registra a
 * passagem no mousemove). Não se aplica easing aqui — o caminho é a solução e
 * precisa ser seguido à risca.
 */
async function runDrag(tabId, plan, opts) {
  const human = opts.human !== false;
  const speed = opts.speed || 1;
  const pts = (plan && plan.pontos) || [];
  if (pts.length < 2) return { done: 0, total: 0, errors: ['plano sem pontos'] };

  const p0 = pts[0];
  await cmd(tabId, 'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: p0.x, y: p0.y, button: 'none', buttons: 0 });
  await sleep(human ? rnd(120, 260) / speed : 30);
  await cmd(tabId, 'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(human ? rnd(150, 300) / speed : 40);

  let done = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    await cmd(tabId, 'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
    done++;
    if (human) await sleep(rnd(14, 30) / speed);
    if (i % 60 === 0) chrome.action.setBadgeText({ tabId, text: `${i}/${pts.length}` }).catch(() => {});
  }

  const pf = pts[pts.length - 1];
  await sleep(human ? rnd(140, 280) / speed : 40);
  await cmd(tabId, 'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: pf.x, y: pf.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);

  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 3500);
  return { done: done, total: pts.length, errors: [] };
}

// ────────────────────────────────────────────────────────────────────────────
// mensagens
// ────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.type !== 'cdpFill' && msg.type !== 'cdpDrag')) return false;

  (async () => {
    const tabId = msg.tabId;
    let attached = false;
    try {
      await attach(tabId);
      attached = true;
      const res = msg.type === 'cdpDrag'
        ? await runDrag(tabId, msg.plan, msg.opts || {})
        : await runPlan(tabId, msg.plan, msg.opts || {});
      sendResponse({ success: true, ...res });
    } catch (e) {
      sendResponse({ success: false, error: String((e && e.message) || e) });
    } finally {
      if (attached) await detach(tabId);
    }
  })();

  return true;   // resposta assíncrona
});
