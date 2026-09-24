#!/usr/bin/env python3
"""Gera a variante Firefox/AMO: assistiva, sem input automático.

A fonte continua sendo extension/. O pipeline reaproveita o build de loja (que já
remove debugger/Sudoku.com/background/<all_urls>) e aplica somente a política
Mozilla deste pacote: esconder o modo Resolver e deixar o modo Só mostrar como
única ação pública.

Uso:
    python tools/build_firefox.py --check
    python tools/build_firefox.py

Saída:
    dist/firefox/
    dist/logic-games-helper-firefox.zip
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "dist" / "store"
OUT = ROOT / "dist" / "firefox"
ZIP = ROOT / "dist" / "logic-games-helper-firefox.zip"


def run_store_build() -> None:
    r = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "build_store.py")],
        cwd=ROOT,
        text=True,
    )
    if r.returncode:
        raise SystemExit(r.returncode)


def transform() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(STORE, OUT)

    # O popup da variante Firefox é assistivo-only. Mesmo se o storage de uma
    # instalação anterior guardar "automatico", o build força o modo seguro.
    popup = OUT / "popup.js"
    text = popup.read_text(encoding="utf-8")
    text = text.replace(
        "if (r && r.modoAcao && MODOS_ACAO[r.modoAcao]) modoAcao = r.modoAcao;",
        "modoAcao = 'assistido'; // AMO: esta variante não automatiza jogadas;",
    )
    popup.write_text(text, encoding="utf-8", newline="\n")

    html = OUT / "popup.html"
    text = html.read_text(encoding="utf-8")
    text = text.replace(
        '<button data-acao="automatico">Resolver</button>',
        '',
    ).replace("G1 Games Helper", "Logic Games Helper")
    html.write_text(text, encoding="utf-8", newline="\n")

    # Nome público dentro do popup/CSS; URLs e diagnósticos do domínio continuam.
    for rel in ["popup.js", "styles.css", "content.js", "g1common.js", "revelar.js"]:
        p = OUT / rel
        t = p.read_text(encoding="utf-8")
        t = t.replace("G1 Games Helper", "Logic Games Helper")
        p.write_text(t, encoding="utf-8", newline="\n")

    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["name"] = "Logic Games Helper"
    manifest["description"] = (
        "Mostra soluções de jogos de lógica no Firefox; você conclui cada jogada."
    )
    manifest["browser_specific_settings"] = {
        "gecko": {
            "id": "logic-games-helper@atanycost-png.github.io",
            "strict_min_version": "142.0",
            "data_collection_permissions": {"required": ["none"]},
        }
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def validate() -> list[str]:
    errors: list[str] = []
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    if "debugger" in manifest.get("permissions", []):
        errors.append("permissão debugger presente")
    if "background" in manifest:
        errors.append("background/service worker presente")
    if manifest.get("content_scripts", [{}])[0].get("matches") != ["https://g1.globo.com/*"]:
        errors.append("host não está restrito ao G1")
    if "automatico" in (OUT / "popup.html").read_text(encoding="utf-8"):
        errors.append("botão automático presente no popup")
    for p in OUT.rglob("*"):
        if not p.is_file() or p.suffix not in {".js", ".html", ".css", ".json"}:
            continue
        text = p.read_text(encoding="utf-8")
        for term in ("chrome.debugger", "<all_urls>", "sudoku.com", "@loja:remove"):
            if term.lower() in text.lower():
                errors.append(f"{term} em {p.relative_to(OUT)}")
    return errors


def zip_output() -> None:
    if ZIP.exists():
        ZIP.unlink()
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(OUT.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(OUT).as_posix())


def main() -> int:
    check_only = "--check" in sys.argv[1:]
    run_store_build()
    transform()
    errors = validate()
    print("pacote: Logic Games Helper — Firefox assistivo")
    print("modo público: Só mostrar a solução")
    print("host: https://g1.globo.com/*")
    print("permissões:", ", ".join(json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))["permissions"]))
    if errors:
        print("\nFALHOU:")
        for e in errors:
            print("  ✗", e)
        return 1
    print("✔ sem debugger, automático, Sudoku.com, background ou <all_urls>")
    if not check_only:
        zip_output()
        print(f"diretório: {OUT}")
        print(f"ZIP: {ZIP} ({ZIP.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
