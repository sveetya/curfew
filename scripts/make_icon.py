"""Draw the Curfew app icon: a navy tile with a crescent and a thin progress arc."""
from PIL import Image, ImageDraw

S = 1024
BG = (16, 26, 42, 255)
FG = (156, 194, 255, 255)
BLUE = (75, 118, 190, 255)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Tile
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)

# Soft inner glow at the top
d.ellipse([-S * 0.2, -S * 0.55, S * 1.2, S * 0.35], fill=(30, 48, 76, 90))

# Crescent: a filled disc with an offset disc punched out
cx, cy, r = S * 0.50, S * 0.46, S * 0.26
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=FG)
d.ellipse([cx - r * 0.55, cy - r * 1.12, cx + r * 1.45, cy + r * 0.88], fill=BG)

# Progress arc along the bottom: three quarters done, one quarter left
bbox = [S * 0.30, S * 0.50, S * 0.70, S * 0.90]
d.arc(bbox, start=20, end=270, fill=BLUE, width=int(S * 0.045))
d.arc(bbox, start=274, end=344, fill=(255, 255, 255, 60), width=int(S * 0.045))

img.save("src-tauri/icons/source.png")
print("wrote src-tauri/icons/source.png", img.size)
