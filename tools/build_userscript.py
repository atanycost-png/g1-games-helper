#!/usr/bin/env python3
"""
Gera o userscript único (Greasy Fork / Tampermonkey / Violentmonkey).

Por que existe: a extensão e o userscript compartilham os MESMOS módulos
(`dito.js`, `soletra.js`, `combinado.js`, `labirinto.js`, `wordsearch.js`,
`crossword.js`, `g1common.js`, `content.js`). Duplicar o código garantiria que as
duas versões divergissem na primeira correção — então o userscript é MONTADO a
partir dos arquivos da extensão, e a única parte exclusiva é `userscript/ui.js`
(o menu, que na extensão é o popup).

Diferenças inevitáveis do ambiente (e estão documentadas no README/LOJA):
  • não existe `chrome.debugger` → Sudoku.com fica fora e o Labirinto vira modo
    assistido (o caminho é mostrado, o jogador traça);
  • não existe popup → o menu vive na página (botão 🧩) + entradas no menu do
    gerenciador de userscripts, quando ele suportar;
  • `chrome.storage` → `GM_getValue/GM_setValue` com fallback para localStorage.

Uso:
    python tools/build_userscript.py            # escreve o .user.js
    python tools/build_userscript.py --check    # valida o que seria gerado
"""

import argparse
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
EXT = RAIZ / "extension"
SAIDA = RAIZ / "userscript" / "g1-games-helper.user.js"

# ordem importa: cada módulo usa os helpers do anterior
MODULOS = [
    "solver.js",       # backtracking 9x9
    "crossword.js",    # palavras cruzadas (mini e grande)
    "wordsearch.js",   # caça-palavras (destaque)
    "g1common.js",     # base: gates, ritmo, painel flutuante, teclado
    "dito.js",
    "soletra.js",
    "combinado.js",
    "labirinto.js",
    "revelar.js",      # modo assistido: mostra a solução sem jogar
    "content.js",      # cadeia de detecção + ações (expõe window.__g1Helper)
]

BANDEIRA = """// ==UserScript==
// @name         G1 Games Helper
// @namespace    https://github.com/atanycost-png/g1-games-helper
// @version      {versao}
// @description  {descricao}
// @author       atanycost-png
// @license      MIT
// @homepageURL  https://github.com/atanycost-png/g1-games-helper
// @supportURL   https://github.com/atanycost-png/g1-games-helper/issues
// @icon         https://raw.githubusercontent.com/atanycost-png/g1-games-helper/master/extension/icons/icon128.png
// @match        https://g1.globo.com/jogos/*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
"""

CABECALHO = """
/* ===========================================================================
 * G1 Games Helper — versão USERSCRIPT
 * ---------------------------------------------------------------------------
 * Este arquivo é GERADO por tools/build_userscript.py a partir dos mesmos
 * módulos usados pela extensão (extension/*.js) — não edite aqui: edite o
 * módulo correspondente e rode o build de novo.
 *
 * Repositório: https://github.com/atanycost-png/g1-games-helper
 * Licença: MIT (c) atanycost-png
 *
 * O que faz: resolve os jogos de lógica e palavras do G1 no seu navegador, com
 * ritmo humanizado e um painel de acompanhamento. Os gabaritos são lidos dos
 * arquivos que o PRÓPRIO site entrega ao navegador (JSONs estáticos e a base
 * embutida do Dito) — nada é enviado para fora e não há servidor.
 * ===========================================================================
 */

(function () {
  'use strict';
"""

RODAPE = """
  // ── arranque ───────────────────────────────────────────────────────────────
  // O menu da página só faz sentido nas páginas de jogo; o @match já limita,
  // mas checar aqui deixa o arquivo seguro se for injetado à mão em outro lugar.
  function arrancar() {
    if (!/\\/jogos\\//.test(location.pathname)) return;
    if (typeof window.g1uiIniciar !== 'function') return;
    window.g1uiIniciar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(arrancar, 300));
  } else {
    setTimeout(arrancar, 300);
  }
})();
"""


# ⚠️ A descrição do userscript NÃO é a mesma da extensão: aqui não existe
# chrome.debugger, então o Sudoku.com fica fora e o Labirinto é assistido. O
# Greasy Fork exige que a descrição corresponda ao que o script realmente faz.
DESCRICAO = ("Mostra ou resolve Sudoku, Dito, Soletra, Combinado, Caça-Palavras e "
             "Cruzadas do G1; no Labirinto mostra o caminho.")


def montar():
    m = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    partes = [
        BANDEIRA.format(versao=m["version"], descricao=DESCRICAO),
        CABECALHO,
    ]
    for nome in MODULOS:
        f = EXT / nome
        if not f.exists():
            sys.exit(f"módulo ausente: {f}")
        partes.append(f"\n/* ---------- {nome} ---------- */\n")
        partes.append(f.read_text(encoding="utf-8"))
    partes.append("\n/* ---------- userscript/ui.js (exclusivo do userscript) ---------- */\n")
    partes.append((RAIZ / "userscript" / "ui.js").read_text(encoding="utf-8"))
    partes.append(RODAPE)
    return "\n".join(partes)


def validar(texto):
    """Checa as regras que o Greasy Fork aplica na publicação."""
    erros, avisos = [], []
    meta = {}
    for linha in texto.split("\n")[:30]:
        mm = re.match(r"//\s*@(\w+)\s+(.*)", linha)
        if mm:
            meta.setdefault(mm.group(1), []).append(mm.group(2).strip())

    exigidos = ["name", "version", "description", "author", "license", "match", "grant"]
    for k in exigidos:
        if k not in meta:
            erros.append(f"metadata obrigatória ausente: @{k}")

    if len(meta.get("description", [""])[0]) > 132:
        erros.append("descrição acima de 132 chars")
    if "none" in meta.get("grant", []) and len(meta.get("grant", [])) > 1:
        erros.append('@grant none misturado com outros grants')

    # regras do Greasy Fork
    if re.search(r"\beval\s*\(", texto):
        erros.append("usa eval() — proibido")
    if re.search(r"new\s+Function\s*\(", texto):
        erros.append("usa new Function() — proibido")
    if re.search(r"https?://[^\"')\s]*(jsdelivr|unpkg|cdnjs)", texto):
        erros.append("carrega biblioteca de CDN (deveria usar @require)")

    tam = len(texto.encode("utf-8"))
    if tam > 2 * 1024 * 1024:
        erros.append(f"arquivo com {tam} bytes — limite do Greasy Fork é 2 MB")

    # minificação: razão de espaços por linha é um bom detector
    linhas = texto.split("\n")
    media = tam / max(1, len(linhas))
    if media > 400:
        avisos.append(f"linhas muito longas (média {media:.0f} chars) — parece minificado")
    if len(linhas) < 200:
        avisos.append("poucas linhas — confira se não veio minificado")

    for m_atch in meta.get("match", []):
        if m_atch.strip() in ("*://*/*", "<all_urls>"):
            erros.append("o Greasy Fork exige @match apenas onde o script funciona")

    return erros, avisos, meta, tam, len(linhas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="não escreve, só valida")
    args = ap.parse_args()

    texto = montar()
    erros, avisos, meta, tam, linhas = validar(texto)

    print(f"arquivo: {SAIDA.relative_to(RAIZ)}")
    print(f"tamanho: {tam:,} bytes ({tam/1024:.0f} KB) · {linhas:,} linhas")
    print(f"@version: {meta.get('version', ['?'])[0]}  ·  @match: {', '.join(meta.get('match', []))}")
    print(f"@grant:   {', '.join(meta.get('grant', []))}")
    print(f"JSONs/módulos embutidos: {len(MODULOS)} + ui.js")
    for a in avisos:
        print("  ⚠️ ", a)
    if erros:
        print("\nFALHOU:")
        for e in erros:
            print("  ✗", e)
        sys.exit(1)
    print("\n✔ PASSou nas regras do Greasy Fork (descrição, licença, @match, sem eval/CDN, <2 MB, não minificado)")

    if not args.check:
        SAIDA.parent.mkdir(parents=True, exist_ok=True)
        SAIDA.write_text(texto, encoding="utf-8")
        print(f"\nescrito: {SAIDA}")


if __name__ == "__main__":
    main()
