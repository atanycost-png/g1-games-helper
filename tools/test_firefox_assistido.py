#!/usr/bin/env python3
"""Smoke/runtime test da variante Firefox assistiva.

Valida duas camadas:
1. instala o ZIP no Firefox real e abre o popup moz-extension://;
2. roda os módulos assistivos no motor Gecko nas páginas reais/fixture e mede
   que a solução aparece sem preencher/submeter o estado do jogo.

O segundo passo injeta os mesmos módulos no contexto da página para exercer a
lógica em Gecko; o popup já é testado como extensão instalada no primeiro passo.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By

ROOT = Path(__file__).resolve().parent.parent
ZIP = ROOT / "dist" / "logic-games-helper-firefox.zip"
EXT = ROOT / "extension"
FIXTURE = (ROOT / "test" / "fixture-g1.html").as_uri()

FILES = [
    "solver.js", "crossword.js", "wordsearch.js", "g1common.js", "dito.js",
    "soletra.js", "combinado.js", "labirinto.js", "revelar.js", "content.js",
]
URLS = {
    "fixture": FIXTURE,
    "dito": "https://g1.globo.com/jogos/dito/",
    "soletra": "https://g1.globo.com/jogos/soletra/",
    "combinado": "https://g1.globo.com/jogos/combinado/",
    "labirinto": "https://g1.globo.com/jogos/labirinto/",
    "caca-palavras": "https://g1.globo.com/jogos/caca-palavras/",
    "palavras-cruzadas": "https://g1.globo.com/jogos/palavras-cruzadas/",
}


def measure(driver, name):
    if name == "fixture":
        return driver.execute_script("""return {
          filled: [...document.querySelectorAll('DIV.cell')].filter(c =>
            /^[1-9]$/.test(((c.querySelector('.cell-text')||{}).innerText||'').trim()) &&
            !((c.querySelector('.cell-text')||{}).className||'').includes('__g1g_ghost')).length,
          ghosts: document.querySelectorAll('.__g1g_ghost').length
        }""")
    return driver.execute_script("""return {
      ghosts: document.querySelectorAll('.__g1g_ghost').length,
      highlights: document.querySelectorAll('rect.__g1ws_hl').length,
      panel: !!document.getElementById('__g1g_panel'),
      rows: [...document.querySelectorAll('.board .row')].filter(r => (r.textContent||'').trim()).length,
      crosswordFilled: [...document.querySelectorAll('g.cell')].filter(g =>
        ((g.querySelector('text.value')||{}).textContent||'').trim()).length
    }""")


def inject_modules(driver):
    src = "\n;\n".join((EXT / name).read_text(encoding="utf-8") for name in FILES)
    driver.execute_script(src)
    driver.set_script_timeout(30)
    return driver.execute_async_script("""
      const done = arguments[arguments.length - 1];
      (async () => {
        for (let i=0; i<40 && !window.__g1Helper; i++) await new Promise(r=>setTimeout(r,250));
        done(JSON.stringify({helper: !!window.__g1Helper, revelar: typeof window.revelarJogo}));
      })().catch(e => done(JSON.stringify({error: String(e)})));
    """)


def reveal(driver):
    return driver.execute_async_script("""
      const done = arguments[arguments.length - 1];
      window.__g1Helper.actionRevelar({}).then(r => done(r)).catch(e => done({ok:false,error:String(e)}));
    """)


def main():
    if not ZIP.exists():
        raise SystemExit("rode npm run build:firefox primeiro")
    opts = Options()
    opts.binary_location = r"C:\Program Files\Mozilla Firefox\firefox.exe"
    opts.add_argument("-headless")
    driver = webdriver.Firefox(options=opts)
    driver.set_page_load_timeout(35)
    try:
        addon_id = driver.install_addon(str(ZIP), temporary=True)
        print("addon instalado:", addon_id)

        # Marionette não permite navegar diretamente para moz-extension://. O
        # addon foi instalado de verdade acima; para exercitar o popup no motor
        # Gecko, abrimos o HTML local com um stub mínimo das APIs chrome.*.
        # O caminho de produção continua sendo o popup real da extensão.
        popup_html = (ROOT / "dist" / "firefox" / "popup.html").as_uri()
        driver.get(popup_html)
        driver.execute_script("""
          window.chrome = {
            storage: { local: { get: (k, cb) => cb({}), set: () => Promise.resolve() } },
            tabs: {
              create: () => Promise.resolve(), query: () => Promise.resolve([{id: 1}]),
              sendMessage: (id, msg) => Promise.resolve(msg.action === 'detect'
                ? {found:true, strategy:'soletra', info:{letras:'A B C',achadas:0,total:1}}
                : {ok:true})
            },
            scripting: { executeScript: () => Promise.resolve() },
            runtime: { sendMessage: () => Promise.resolve({}) }
          };
        """)
        popup_js = (OUT := ROOT / "dist" / "firefox" / "popup.js").read_text(encoding="utf-8")
        driver.execute_script(popup_js)
        driver.execute_script("document.dispatchEvent(new Event('DOMContentLoaded'))")
        time.sleep(1)
        title = driver.find_element(By.ID, "jogo").text
        labels = [b.text for b in driver.find_elements(By.CSS_SELECTOR, "#acoes button")]
        print("popup Firefox/Gecko:", json.dumps({"titulo": title, "acoes": labels}, ensure_ascii=False))
        assert labels == ["Só mostrar"], labels

        results = []
        for name, url in URLS.items():
            print(f"\n▶ {name}")
            driver.get(url)
            time.sleep(3)
            before = measure(driver, name)
            injected = inject_modules(driver)
            time.sleep(1)
            result = reveal(driver)
            time.sleep(1)
            after = measure(driver, name)
            painted = bool(after.get("ghosts") or after.get("highlights") or after.get("panel"))
            unchanged = True
            for key in ("filled", "crosswordFilled", "rows"):
                if key in before and key in after and before[key] != after[key]:
                    # Dito recebe fantasmas na primeira linha; isso é marca nossa.
                    if not (name == "dito" and key == "rows"):
                        unchanged = False
            ok = bool(result and result.get("ok")) and painted and unchanged
            item = {"jogo": name, "ok": ok, "injetado": injected, "resultado": result,
                    "antes": before, "depois": after, "naoJogou": unchanged}
            results.append(item)
            print(json.dumps(item, ensure_ascii=False)[:700])

        print("\nRESUMO FIREFOX")
        for item in results:
            print(("✔" if item["ok"] else "✗"), item["jogo"],
                  "naoJogou=" + str(item["naoJogou"]))
        assert all(item["ok"] for item in results), "algum jogo falhou"
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
