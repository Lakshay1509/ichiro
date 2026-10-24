# build.py: draws every Ichiro logo file (wordmark, symbol, icons, lockups) as plain SVG paths
# Run: python art/logo/build.py   → writes art/logo/svg/
import math
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "svg")
INK, BLUE, WHITE = "#000000", "#0075de", "#ffffff"  # ink and blue come from DESIGN.md


def f(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def rect(x, y, w, h):
    return f"M{f(x)} {f(y)}H{f(x + w)}V{f(y + h)}H{f(x)}Z"


def round_rect(x, y, w, h, r):
    return (f"M{f(x + r)} {f(y)}H{f(x + w - r)}A{f(r)} {f(r)} 0 0 1 {f(x + w)} {f(y + r)}"
            f"V{f(y + h - r)}A{f(r)} {f(r)} 0 0 1 {f(x + w - r)} {f(y + h)}"
            f"H{f(x + r)}A{f(r)} {f(r)} 0 0 1 {f(x)} {f(y + h - r)}"
            f"V{f(y + r)}A{f(r)} {f(r)} 0 0 1 {f(x + r)} {f(y)}Z")


def ellipse(cx, cy, rx, ry, hole=False):
    s = 0 if hole else 1  # counter-clockwise winding cuts a hole (nonzero fill)
    return (f"M{f(cx - rx)} {f(cy)}A{f(rx)} {f(ry)} 0 1 {s} {f(cx + rx)} {f(cy)}"
            f"A{f(rx)} {f(ry)} 0 1 {s} {f(cx - rx)} {f(cy)}Z")


def circle(cx, cy, r, hole=False):
    return ellipse(cx, cy, r, r, hole)


# --- the eye: one proportion everywhere, scaled by its radius R ---
RING, PUPIL, LOOK = 0.45, 0.31, 0.12  # ring width, pupil radius, pupil shift right (all × R)


def eye(cx, cy, R, pupil=PUPIL, look=LOOK):
    """(ring, pupil, disc). Light backgrounds draw ring + pupil; dark ones draw the disc with the pupil cut out,
    so the white of the eye stays white instead of turning into a photo negative."""
    px = cx + look * R
    return (circle(cx, cy, R) + circle(cx, cy, R * (1 - RING), hole=True),
            circle(px, cy, pupil * R),
            circle(cx, cy, R) + circle(px, cy, pupil * R, hole=True))


# --- letters: lowercase, geometric, built from rects, circles and arcs ---
T = 24                                  # stem width
TOP, BASE, ASC = 88, 200, 26            # x-height line, baseline, ascender top
BOWL_R, BOWL_CY, IN_RX, IN_RY = 58, 144, 34, 36    # bowls overshoot by 2; inner ellipse thins the horizontals
ARCH_R, ARCH_CY, ARCH_RX, ARCH_RY = 50, 138, 26, 28  # same trick on the h and r arches


def stem(x):
    return rect(x, TOP, T, BASE - TOP)


def letter_c(cx):
    k = 1 / math.sqrt(1 / IN_RX**2 + 1 / IN_RY**2)  # inner ellipse point on the 45° ray
    o = BOWL_R * math.sqrt(0.5)
    cy = BOWL_CY
    return (f"M{f(cx + o)} {f(cy - o)}A{BOWL_R} {BOWL_R} 0 1 0 {f(cx + o)} {f(cy + o)}"
            f"L{f(cx + k)} {f(cy + k)}A{IN_RX} {IN_RY} 0 1 1 {f(cx + k)} {f(cy - k)}Z")


def letter_o(cx):
    return circle(cx, BOWL_CY, BOWL_R) + ellipse(cx, BOWL_CY, IN_RX, IN_RY, hole=True)


def arch_join_y():
    return ARCH_CY - math.sqrt(ARCH_R**2 - (ARCH_R - T) ** 2)  # where the arch leaves the stem


def letter_h(x0):
    w = 2 * ARCH_R
    return (f"M{f(x0)} {ASC}H{f(x0 + T)}V{f(arch_join_y())}"
            f"A{ARCH_R} {ARCH_R} 0 0 1 {f(x0 + w)} {ARCH_CY}V{BASE}H{f(x0 + w - T)}"
            f"V{ARCH_CY}A{ARCH_RX} {ARCH_RY} 0 0 0 {f(x0 + T)} {ARCH_CY}V{BASE}H{f(x0)}Z")


def letter_r(x0, end_deg=-60):
    a = math.radians(end_deg)
    cx = x0 + ARCH_R
    ox, oy = cx + ARCH_R * math.cos(a), ARCH_CY + ARCH_R * math.sin(a)
    ix, iy = cx + ARCH_RX * math.cos(a), ARCH_CY + ARCH_RY * math.sin(a)
    return (f"M{f(x0)} {TOP}H{f(x0 + T)}V{f(arch_join_y())}A{ARCH_R} {ARCH_R} 0 0 1 {f(ox)} {f(oy)}"
            f"L{f(ix)} {f(iy)}A{ARCH_RX} {ARCH_RY} 0 0 0 {f(x0 + T)} {ARCH_CY}V{BASE}H{f(x0)}Z")


# --- the three drawings ---
I1, C_CX, H_X, I2, R_X, O_CX = 0, 104, 166, 296, 350, 495  # i c h i r o, optically spaced
EYE_R = 26
EYE_CY = TOP - 12 - EYE_R
WORD_BOX = (-14, 24, 567, 178)  # x, y, w, h: eye top to bowl overshoot
SYM_BOX = (34, 32, 188, 188)    # the symbol's footprint on its 256 canvas


def wordmark():
    letters = stem(I1) + letter_c(C_CX) + letter_h(H_X) + stem(I2) + letter_r(R_X) + letter_o(O_CX)
    return letters, [eye(x + T / 2, EYE_CY, EYE_R) for x in (I1, I2)]


def symbol():
    # the two i's at icon scale: eyes big, stems short
    return rect(58, 140, 40, 80) + rect(158, 140, 40, 80), [eye(78, 76, 44), eye(178, 76, 44)]


def small_mark():
    # 16 px cut, drawn on a 16-unit pixel grid ×16; bigger pupil so it survives as one pixel
    eyes = [eye(cx, 88, 40, pupil=0.4, look=0.25) for cx in (80, 176)]
    return rect(64, 144, 32, 64) + rect(160, 144, 32, 64), eyes


assert EYE_CY + EYE_R < TOP and 76 + 44 < 140 and 88 + 40 < 144, "an eye touches its stem"


# --- paint ---
def light(body, eyes, main, pupil, t=None):
    return [(body + "".join(e[0] for e in eyes), main, t), ("".join(e[1] for e in eyes), pupil, t)]


def dark(body, eyes, t=None):
    return [(body + "".join(e[2] for e in eyes), WHITE, t)]


def tile(x, y, size, small=False):
    """Blue rounded square with the white (dark-background) symbol on it."""
    if small:
        body, eyes = small_mark()
        s = size / 256
        return [(round_rect(x, y, size, size, 0.1875 * size), BLUE, None)] + dark(
            body, eyes, f"translate({f(x)} {f(y)}) scale({f(s)})")
    body, eyes = symbol()
    s = 0.62 * size / SYM_BOX[2]
    cx, cy = SYM_BOX[0] + SYM_BOX[2] / 2, SYM_BOX[1] + SYM_BOX[3] / 2
    tx, ty = x + size / 2 - s * cx, y + size / 2 - 0.01 * size - s * cy  # nudged up 1 % to sit optically centred
    return [(round_rect(x, y, size, size, 0.225 * size), BLUE, None)] + dark(
        body, eyes, f"translate({f(tx)} {f(ty)}) scale({f(s)})")


def write(name, box, layers, title):
    x, y, w, h = box
    paths = "".join(f'<path fill="{c}" d="{d}"' + (f' transform="{t}"' if t else "") + "/>"
                    for d, c, t in layers if d)
    with open(os.path.join(OUT, f"{name}.svg"), "w", encoding="utf-8") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x)} {f(y)} {f(w)} {f(h)}">'
                 f"<title>{title}</title>{paths}</svg>\n")


def main():
    os.makedirs(OUT, exist_ok=True)
    letters, weyes = wordmark()
    stems, seyes = symbol()
    for name, box, body, eyes in (("wordmark", WORD_BOX, letters, weyes), ("symbol", (0, 0, 256, 256), stems, seyes)):
        write(f"ichiro-{name}", box, light(body, eyes, INK, BLUE), "Ichiro")
        write(f"ichiro-{name}-black", box, light(body, eyes, INK, INK), "Ichiro")
        write(f"ichiro-{name}-blue", box, light(body, eyes, BLUE, BLUE), "Ichiro")
        write(f"ichiro-{name}-white", box, dark(body, eyes), "Ichiro")

    write("ichiro-icon", (0, 0, 256, 256), tile(0, 0, 256), "Ichiro")
    write("ichiro-icon-small", (0, 0, 256, 256), tile(0, 0, 256, small=True), "Ichiro")

    # horizontal: tile as tall as the wordmark, one tile-quarter gap
    word_x = 178 + 48 - WORD_BOX[0]
    h_box = (0, 24, word_x + WORD_BOX[0] + WORD_BOX[2], 178)
    write("ichiro-horizontal", h_box, tile(0, 24, 178) + light(letters, weyes, INK, BLUE, f"translate({f(word_x)} 0)"), "Ichiro")
    write("ichiro-horizontal-white", h_box, tile(0, 24, 178) + dark(letters, weyes, f"translate({f(word_x)} 0)"), "Ichiro")

    # stacked: tile centred over the wordmark
    mid = WORD_BOX[0] + WORD_BOX[2] / 2
    s_box = (WORD_BOX[0], 0, WORD_BOX[2], 232 + WORD_BOX[1] + WORD_BOX[3])
    write("ichiro-stacked", s_box, tile(mid - 100, 0, 200) + light(letters, weyes, INK, BLUE, "translate(0 232)"), "Ichiro")
    write("ichiro-stacked-white", s_box, tile(mid - 100, 0, 200) + dark(letters, weyes, "translate(0 232)"), "Ichiro")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
