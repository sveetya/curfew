"""Rasterise Marek's Curfew icon SVG without a renderer.

The SVG is a navy disc, a vertical #070E19 veil and an embedded PNG emblem.
Composing those three layers in Pillow is exact and needs no cairo/rsvg.
"""
import base64
import io
import re

from PIL import Image, ImageDraw

SRC = "src-tauri/icons/source.svg"
OUT = "src-tauri/icons/source.png"
S = 512

svg = open(SRC).read()

match = re.search(r'<image[^>]*xlink:href="data:image/png;base64,([^"]+)"', svg)
if not match:
    raise SystemExit("no embedded emblem found")
emblem = Image.open(io.BytesIO(base64.b64decode(match.group(1)))).convert("RGBA")

# Navy disc
canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
disc = Image.new("RGBA", (S, S), (26, 54, 93, 255))  # #1A365D
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
canvas.paste(disc, (0, 0), mask)

# Vertical veil: #070E19 from 0.9 alpha at the top to 0.8 at the bottom of 630px
veil = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw = ImageDraw.Draw(veil)
for y in range(S):
    t = min(1.0, y / 630)
    alpha = int(round(255 * (0.9 + (0.8 - 0.9) * t)))
    draw.line([(0, y), (S, y)], fill=(7, 14, 25, alpha))
canvas = Image.alpha_composite(canvas, veil)

# Emblem at 132,132 sized 249
emblem = emblem.resize((249, 249), Image.LANCZOS)
canvas.alpha_composite(emblem, (132, 132))

# Clip everything to the disc again so the emblem cannot bleed past the edge
clipped = Image.new("RGBA", (S, S), (0, 0, 0, 0))
clipped.paste(canvas, (0, 0), mask)

big = clipped.resize((1024, 1024), Image.LANCZOS)
big.save(OUT)
print("wrote", OUT, big.size, big.mode)
