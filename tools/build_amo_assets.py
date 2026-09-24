#!/usr/bin/env python3
"""Gera assets reais para a página do Firefox Add-ons.

Fontes das screenshots: capturas do modo assistido executado no jogo real,
armazenadas em assets/amo/source/. O script apenas compõe e redimensiona; não
inventa estado, resultado ou interface.
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "amo" / "source"
OUT = ROOT / "assets" / "amo" / "final"
ICON_OUT = ROOT / "extension" / "icons"

BG = (14, 17, 28)
CARD = (27, 32, 48)
TEXT = (245, 247, 255)
MUTED = (171, 180, 202)
PINK = (224, 69, 123)
BLUE = (77, 177, 255)


def font(size: int, bold: bool = False):
    candidates = [
        "C:/Windows/Fonts/segoeui bold.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def screenshot(name: str, title: str, subtitle: str):
    src = Image.open(SRC / f"{name}.png").convert("RGB")
    canvas = Image.new("RGB", (1280, 800), BG)
    d = ImageDraw.Draw(canvas)
    d.text((54, 30), title, fill=TEXT, font=font(30, True))
    d.text((54, 70), subtitle, fill=MUTED, font=font(17))
    d.rounded_rectangle((54, 116, 1226, 758), radius=16, fill=CARD, outline=(54, 65, 92), width=2)

    max_w, max_h = 1128, 594
    ratio = min(max_w / src.width, max_h / src.height)
    size = (round(src.width * ratio), round(src.height * ratio))
    image = src.resize(size, Image.Resampling.LANCZOS)
    x = 640 - image.width // 2
    y = 437 - image.height // 2
    canvas.paste(image, (x, y))
    out = OUT / f"{name}.png"
    canvas.save(out, optimize=True)
    return out


def icon(size: int):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = size
    d.rounded_rectangle((2, 2, s - 3, s - 3), radius=max(3, s // 5), fill=(16, 22, 42, 255))
    pad = s * 0.18
    gap = s * 0.045
    cell = (s - 2 * pad - 2 * gap) / 3
    for row in range(3):
        for col in range(3):
            x = pad + col * (cell + gap)
            y = pad + row * (cell + gap)
            fill = (231, 237, 250, 255)
            if row == 1 and col == 1:
                fill = (224, 69, 123, 255)
            elif row == 0 and col == 2:
                fill = (77, 177, 255, 255)
            d.rounded_rectangle((x, y, x + cell, y + cell), radius=max(1, int(cell * .18)), fill=fill)
    # pequena marca de olho/assistivo no centro do quadrante inferior
    cx, cy = s * .5, s * .78
    r = s * .055
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(255, 255, 255, 235))
    out = ICON_OUT / f"icon{size}.png"
    im.save(out, optimize=True)
    return out


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for args in [
        ("dito", "Dito · solução visível, jogada manual", "Modo assistido: a resposta aparece, você confirma no jogo"),
        ("labirinto", "Labirinto · siga o trajeto", "A extensão mostra o caminho; o jogador conduz a jogada"),
        ("cruzadas", "Palavras Cruzadas · letras fantasma", "A solução fica visível sem preencher o tabuleiro"),
    ]:
        print(screenshot(*args))
    for size in (128, 48, 16):
        print(icon(size))
