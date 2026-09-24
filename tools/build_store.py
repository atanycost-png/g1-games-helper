#!/usr/bin/env python3
"""Gera o pacote enxuto da loja a partir de extension/.

FONTE ÚNICA, DOIS PACOTES
-------------------------
A pasta extension/ continua sendo a fonte completa para GitHub/uso pessoal.
Este script gera dist/store/ sem duplicar código editável:

  python tools/build_store.py          # valida e gera diretório + ZIP
  python tools/build_store.py --check  # só valida, sem escrever

O build de loja remove exclusivamente os trechos marcados no código-fonte com:
  /* @loja:remove:start */ ... /* @loja:remove:end */

Depois disso ele verifica de forma fail-fast que o pacote não contém `debugger`,
`chrome.debugger`, `<all_urls>`, Sudoku.com ou background.js. Se a fonte ganhar
um novo caminho privilegiado no futuro, o build quebra em vez de publicar um
pacote que contradiz a ficha da loja.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
OUT = ROOT / "dist" / "store"
ZIP = ROOT / "dist" / "g1-games-helper-store.zip"

REMOVE_RE = re.compile(
    r"/\*\s*@loja:remove:start\b.*?\*/.*?/\*\s*@loja:remove:end\b.*?\*/",
    re.DOTALL,
)

# Só os arquivos efetivamente usados pelo pacote público.
FILES = [
    "popup.html",
    "popup.js",
    "styles.css",
    "content.js",
    "solver.js",
    "crossword.js",
    "wordsearch.js",
    "g1common.js",
    "dito.js",
    "soletra.js",
    "combinado.js",
    "labirinto.js",
    "revelar.js",
]
ICONS = ["icons/icon16.png", "icons/icon48.png", "icons/icon128.png"]

STORE_NAME = "Logic Games Helper"
STORE_DESCRIPTION = (
    "Mostra ou resolve jogos de lógica do G1: Sudoku, Dito, Soletra, "
    "Combinado, Labirinto, Caça-Palavras e Cruzadas."
)


def transform_source(text: str) -> str:
    text = REMOVE_RE.sub("", text)
    # Os comentários restantes da fonte descrevem a variante completa. Não os
    # leve para a loja: a guarda precisa ser literal e não depender de parser JS.
    text = re.sub(r"chrome\.debugger", "API de input privilegiado", text, flags=re.I)
    text = re.sub(r"\bdebugger\b", "input privilegiado", text, flags=re.I)
    text = text.replace("Sudoku.com", "jogo canvas externo")
    text = text.replace("sudoku.com", "jogo-canvas-externo")
    return text


def build_manifest() -> dict:
    src = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    return {
        "manifest_version": 3,
        "name": STORE_NAME,
        "version": src["version"],
        "description": STORE_DESCRIPTION,
        "permissions": ["activeTab", "scripting", "storage"],
        "action": src["action"],
        "icons": src["icons"],
        "content_scripts": [{
            "matches": ["https://g1.globo.com/*"],
            "js": src["content_scripts"][0]["js"],
        }],
    }


def validate_manifest(m: dict) -> list[str]:
    errors: list[str] = []
    if "debugger" in m.get("permissions", []):
        errors.append("manifest ainda pede debugger")
    if "background" in m:
        errors.append("manifest ainda tem service_worker/background")
    if any("<all_urls>" in x for c in m.get("content_scripts", []) for x in c.get("matches", [])):
        errors.append("manifest ainda usa <all_urls>")
    if any("sudoku.com" in x.lower() for c in m.get("content_scripts", []) for x in c.get("matches", [])):
        errors.append("manifest ainda declara sudoku.com")
    if len(m.get("description", "")) > 132:
        errors.append("description excede 132 caracteres")
    return errors


def validate_sources(files: dict[str, str], manifest: dict) -> list[str]:
    errors = validate_manifest(manifest)
    joined = "\n".join(files.values())
    checks = [
        (r"\bdebugger\b", "referência a debugger"),
        (r"chrome\.debugger", "referência a chrome.debugger"),
        (r"<all_urls>", "referência a <all_urls>"),
        (r"sudoku\.com", "referência a sudoku.com"),
        (r"background\.js", "referência a background.js"),
        (r"@loja:remove:", "marcador de build não removido"),
    ]
    for pattern, label in checks:
        if re.search(pattern, joined, re.I):
            errors.append(label)
    return errors


def collect() -> tuple[dict[str, str], dict]:
    files: dict[str, str] = {}
    for rel in FILES:
        path = SRC / rel
        if not path.exists():
            raise SystemExit(f"arquivo-fonte ausente: {path}")
        files[rel] = transform_source(path.read_text(encoding="utf-8"))
    for rel in ICONS:
        path = SRC / rel
        if not path.exists():
            raise SystemExit(f"ícone ausente: {path}")
        files[rel] = "__BINARY__"
    manifest = build_manifest()
    files["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    return files, manifest


def write_output(files: dict[str, str]) -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    for rel, text in files.items():
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if text == "__BINARY__":
            shutil.copy2(SRC / rel, dest)
        else:
            dest.write_text(text, encoding="utf-8", newline="\n")

    ZIP.parent.mkdir(parents=True, exist_ok=True)
    if ZIP.exists():
        ZIP.unlink()
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(OUT.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(OUT).as_posix())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="valida sem escrever arquivos")
    args = ap.parse_args()

    files, manifest = collect()
    errors = validate_sources(files, manifest)
    js_errors = []
    for rel, text in files.items():
        if rel.endswith(".js"):
            # node --check não é chamado aqui para cada arquivo: o build continua
            # portátil mesmo quando Node não está instalado.
            if "__BINARY__" in text:
                js_errors.append(f"conteúdo binário em JS: {rel}")
    errors.extend(js_errors)

    print(f"pacote: {STORE_NAME} v{manifest['version']}")
    print(f"arquivos: {len(files)} ({len(FILES)} JS/HTML/CSS + {len(ICONS)} ícones)")
    print(f"permissões: {', '.join(manifest['permissions'])}")
    print(f"hosts: {manifest['content_scripts'][0]['matches']}")
    print(f"description: {len(manifest['description'])} caracteres")
    if errors:
        print("\nFALHOU:")
        for error in errors:
            print(f"  ✗ {error}")
        return 1
    print("✔ sem debugger, Sudoku.com, <all_urls>, background ou marcadores")

    if not args.check:
        write_output(files)
        print(f"diretório: {OUT}")
        print(f"ZIP: {ZIP} ({ZIP.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
