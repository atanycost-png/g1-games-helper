#!/usr/bin/env python3
"""
Smoke test do POPUP da extensão (popup.html + popup.js), sem instalar a extensão.

Os outros testes cobrem os content scripts; o popup nunca era exercitado. Aqui a
página recebe um stub das APIs `chrome.*` (tabs/scripting/runtime/storage) e o
popup é montado de verdade — assim a gente vê se ele renderiza o menu, se o card
do jogo aparece e se alguma chamada derruba o DOMContentLoaded.

Uso:
    python test_popup_cdp.py
    python test_popup_cdp.py --sem-storage   # simula a permissão "storage" ausente
"""

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

try:
    import websocket
except ImportError:
    sys.exit("falta websocket-client:  pip install websocket-client")

CDP_HTTP = "http://127.0.0.1:9222"
EXT = Path(__file__).resolve().parent.parent / "extension"


class Page:
    def __init__(self):
        with urllib.request.urlopen(CDP_HTTP + "/json/list", timeout=5) as r:
            tabs = [x for x in json.load(r) if x.get("type") == "page"]
        self.ws = websocket.create_connection(tabs[0]["webSocketDebuggerUrl"], timeout=300, max_size=None)
        self._id = 0

    def send(self, method, **params):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def js(self, expr, await_promise=False):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=await_promise)
        if r.get("exceptionDetails"):
            return {"__erro": str(r["exceptionDetails"].get("exception", {}).get("description"))[:400]}
        return (r.get("result") or {}).get("value")


STUB = """
window.__erros = [];
window.addEventListener('error', e => window.__erros.push(String(e.message)));

const detectResp = {
  found: true, strategy: 'soletra', game: 'soletra', filled: 0, empty: 0,
  info: { game: 'soletra', letras: 'Z A I M O R T', achadas: 3, total: 29 },
  diag: { site: 'g1', url: 'https://g1.globo.com/jogos/soletra/', issues: [] }
};

const chamadas = [];
window.__chamadas = chamadas;

const noop = (nome) => (...a) => {
  chamadas.push(nome);
  const cb = a.find(x => typeof x === 'function');
  if (nome === 'tabs.query') {
    const cb2 = a.find(x => typeof x === 'function');
    cb2 && cb2([{ id: 7, url: 'https://g1.globo.com/jogos/soletra/' }]);
    return Promise.resolve([{ id: 7 }]);
  }
  if (nome === 'tabs.sendMessage') {
    const msg = a[1] || {};
    const resp = msg.action === 'ping' ? { ok: true } : detectResp;
    return Promise.resolve(resp);
  }
  if (cb) cb({});
  return Promise.resolve({});
};

window.chrome = {
  tabs: {
    query: (...a) => { chamadas.push('tabs.query');
      const cb = a.find(x => typeof x === 'function');
      if (cb) { cb([{ id: 7 }]); return undefined; }
      return Promise.resolve([{ id: 7 }]); },
    sendMessage: (...a) => { chamadas.push('tabs.sendMessage:' + ((a[1] || {}).action || ''));
      return Promise.resolve((a[1] || {}).action === 'ping' ? { ok: true } : detectResp); },
    create: (...a) => { chamadas.push('tabs.create'); return Promise.resolve({}); }
  },
  scripting: { executeScript: (...a) => { chamadas.push('scripting.executeScript'); return Promise.resolve([]); } },
  runtime: { sendMessage: (...a) => { chamadas.push('runtime.sendMessage'); return Promise.resolve({ success: true, done: 1, total: 1 }); } },
  action: { setBadgeText: () => Promise.resolve() }
};
if (!window.__semStorage) {
  window.chrome.storage = { local: {
    get: (k, cb) => { chamadas.push('storage.get'); cb && cb({ modo: 'normal', fechar: false }); },
    set: (o, cb) => { chamadas.push('storage.set'); cb && cb(); }
  } };
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sem-storage", action="store_true", help='simula manifest sem a permissão "storage"')
    args = ap.parse_args()

    html = (EXT / "popup.html").read_text(encoding="utf-8")
    corpo = html.split("<body>")[1].split("<script")[0]
    js = (EXT / "popup.js").read_text(encoding="utf-8")

    p = Page()
    p.send("Page.enable")
    p.send("Page.navigate", url="about:blank")
    time.sleep(2)

    p.js(f"window.__semStorage = {str(args.sem_storage).lower()};")
    p.js(STUB)
    p.js(f"document.body.innerHTML = {json.dumps(corpo)};")
    p.js(js)                       # roda popup.js
    p.js("document.dispatchEvent(new Event('DOMContentLoaded'))")
    time.sleep(2.5)

    r = p.js("""JSON.stringify({
      erros: window.__erros,
      chips: document.querySelectorAll('.chip').length,
      linhaJogo: (document.getElementById('jogo') || {}).textContent,
      badge: (document.getElementById('badge') || {}).textContent,
      info: (document.getElementById('info') || {}).textContent,
      botao: (document.getElementById('acao') || {}).textContent,
      botaoHabilitado: !(document.getElementById('acao') || {}).disabled,
      sub: (document.getElementById('sub') || {}).textContent,
      ritmoAtivo: (document.querySelector('.seg button.on') || {}).textContent,
      fecharMarcado: (document.getElementById('fechar-popup') || {}).checked,
      chamadas: window.__chamadas
    })""")
    # `js()` devolve o JSON como STRING (o evaluate serializou) — parse antes de julgar
    if isinstance(r, str):
        try:
            r = json.loads(r)
        except Exception:
            pass
    print(json.dumps(r, ensure_ascii=False, indent=1))
    p.ws.close()

    ok = (isinstance(r, dict) and not r.get("__erro") and r.get("chips") == 10
          and r.get("botaoHabilitado") and not r.get("erros"))
    print("\n" + ("✔ POPUP OK" if ok else "✗ POPUP COM PROBLEMA"))


if __name__ == "__main__":
    main()
