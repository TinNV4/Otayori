#!/usr/bin/env python3
"""
Make the "unread policy news" rich-menu variant: assets/richmenu.png + a red dot on the "Trang gia đình" button.
Needs Pillow (pip install pillow). Re-run after changing assets/richmenu.png:

  python3 scripts/make-richmenu-dot.py [assets/richmenu.png] [assets/richmenu-dot.png]
"""
import sys
from PIL import Image, ImageDraw

src = sys.argv[1] if len(sys.argv) > 1 else "assets/richmenu.png"
dst = sys.argv[2] if len(sys.argv) > 2 else "assets/richmenu-dot.png"

img = Image.open(src).convert("RGB")
w, h = img.size
assert (w, h) == (2500, 843), f"expected 2500x843, got {w}x{h}"

# Button 4 = column 0, row 1 (see scripts/richmenu.ts): x 0..833, y 421..843. Dot sits in its top-right corner.
cx, cy, r = 760, 485, 36
scale = 4  # draw 4x and shrink for smooth edges
layer = Image.new("RGBA", (2 * (r + 12) * scale,) * 2, (0, 0, 0, 0))
d = ImageDraw.Draw(layer)
c = layer.size[0] // 2
d.ellipse([c - (r + 10) * scale, c - (r + 10) * scale, c + (r + 10) * scale, c + (r + 10) * scale], fill=(255, 255, 255, 255))
d.ellipse([c - r * scale, c - r * scale, c + r * scale, c + r * scale], fill=(239, 68, 68, 255))
layer = layer.resize((layer.size[0] // scale, layer.size[1] // scale), Image.LANCZOS)
img.paste(layer, (cx - layer.size[0] // 2, cy - layer.size[1] // 2), layer)
img.save(dst, optimize=True)
print(f"wrote {dst}")
