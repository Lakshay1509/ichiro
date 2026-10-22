# Encodes the cradle frames into one looping GIF (shared palette, exact panel background) plus a still PNG.
import glob, sys
from PIL import Image

out, colors = sys.argv[1], int(sys.argv[2])
frames = [Image.open(f).convert("RGB") for f in sorted(glob.glob(out + "/f*.png"))]
BG = (0xF6, 0xF5, 0xF4)
w, h = frames[0].size
sheet = Image.new("RGB", (w, h * len(frames)))
for i, f in enumerate(frames):
    sheet.paste(f, (0, i * h))
pal = sheet.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
# Pillow's palette lookup is approximate, so snap every entry within a shade of the background to it exactly
p = q[0].getpalette()[: colors * 3]
for i in range(colors):
    if sum(abs(p[3 * i + j] - BG[j]) for j in range(3)) <= 3:
        p[3 * i : 3 * i + 3] = BG
for f in q:
    f.putpalette(p)
q[0].save(out + "/cradle.gif", save_all=True, append_images=q[1:], duration=40, loop=0, disposal=1)
q[0].save(out + "/cradle.png", optimize=True)
check = Image.open(out + "/cradle.gif").convert("RGB")
print("frames", len(frames), "size", w, "x", h, "corner", check.getpixel((0, 0)), "bg ok", check.getpixel((0, 0)) == BG)
