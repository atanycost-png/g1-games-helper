#!/usr/bin/env python3
"""Pipeline oficial do código-fonte enviado ao Mozilla Add-ons.

Executa todos os passos técnicos necessários para gerar a cópia exata da
variante Firefox assistiva:
  1. ícones/screenshots;
  2. build intermediário sem debugger;
  3. pacote Firefox final.

Uso:
    python tools/build_amo.py
    python tools/build_amo.py --check
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(name: str, args: list[str]) -> None:
    print(f"\n== {name} ==")
    result = subprocess.run([sys.executable, *args], cwd=ROOT)
    if result.returncode:
        raise SystemExit(result.returncode)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="valida sem gerar o ZIP final")
    args = parser.parse_args()

    run("assets", ["tools/build_amo_assets.py"])
    run("firefox", ["tools/build_firefox.py", "--check" if args.check else ""] if args.check else ["tools/build_firefox.py"])
    print("\n✔ pipeline AMO concluído")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
