# Ichiro logo: how to use it

**Main logo = the wordmark.** The dots on its two i's are eyes, like the two cameras on WABOT-1, Ichiro Kato's 1973 robot.

## 1. Which file

| You need | Use |
|---|---|
| Logo on a light page | `svg/ichiro-wordmark.svg` (black letters, blue pupils) |
| Logo on a dark page | `svg/ichiro-wordmark-white.svg` |
| Icon + name (README header, store banner) | `svg/ichiro-horizontal.svg` · on dark: `-white` |
| Centred layouts (splash, slide title) | `svg/ichiro-stacked.svg` · on dark: `-white` |
| Any icon (toolbar, favicon, avatar) | the blue tile: `svg/ichiro-icon.svg` |
| Icon at 16–32 px | `svg/ichiro-icon-small.svg` (thicker drawing for tiny sizes) |
| One-colour print, stamp, engraving | `svg/ichiro-symbol-black.svg` or `svg/ichiro-wordmark-black.svg` |

- PNGs of the main files are in `png/`.
- **Chrome extension icons** are in `icons/`: `icon-16`, `icon-32` (toolbar), `icon-48` (extensions page), `icon-128` (Web Store: 96 px artwork + 16 px clear padding, per [Chrome's docs](https://developer.chrome.com/docs/webstore/images)). Also `favicon.ico`, `favicon.svg`, `icon-512.png`.

## 2. The one rule that's easy to break

**Never just recolour the logo white.** A white copy of the light logo turns the eyes into a photo negative (dark whites, white pupils). The `-white` files are drawn differently: solid white eyes with the pupil cut out. Always use them on dark backgrounds.

Same for the tile: in one colour it becomes a plain square. For one-colour work, use the plain symbol, not the tile.

## 3. Clear space

Keep **one eye's width** of empty space on every side. "Eye" = the ring on an i in the wordmark. It scales with the logo.

## 4. Minimum size

| Version | Screen | Print |
|---|---|---|
| Wordmark | 80 px wide | 20 mm wide |
| Horizontal | 112 px wide | 28 mm wide |
| Icon tile | 16 px (use `icon-small` up to 32 px) | 6 mm |
| Symbol without tile | 24 px | 6 mm |

## 5. Colour

| Name | HEX | RGB | CMYK (approx.) | Pantone (nearest) |
|---|---|---|---|---|
| Ichiro Blue | `#0075de` | 0 117 222 | 100 47 0 13 | 285 C |
| Ink | `#000000` | 0 0 0 | 0 0 0 100 | Black C |
| Paper | `#f6f5f4` | 246 245 244 | — | — |

- Blue and ink are the side panel's own colours (`DESIGN.md`).
- **Blue goes in the pupils only.** Everything else is ink.
- CMYK is a plain conversion and Pantone is a nearest match. Proof both on a real swatch before printing.

**Approved pairs:** colour logo on white or paper · `-white` logo on black or dark grey · blue tile on anything · black logo on white.

## 6. Type next to the logo

**Inter** (free, SIL Open Font License), like the side panel. The wordmark is drawn from shapes, not a font, so never retype "ichiro" to make a logo.

## 7. Don't

- stretch, squash, rotate or tilt it
- move the pupils, or make the eyes look different ways
- add shadows, outlines, gradients or glows
- use colours outside the table
- put it on a busy photo without the tile

## 8. Changing the logo

All SVGs come from one script: run `python art/logo/build.py` and it rewrites `svg/`. The eye proportions live in one line (`RING, PUPIL, LOOK`), so every file stays in step. PNGs, icons and the board are rendered from those SVGs with the logo-design skill's scripts (`render_png.py`, `presentation_board.py`; the board spec is `board/spec.json`).

## 9. Open items

- **Trademark search** not done. Run one (and a reverse image search) before going public.
- **Extension not updated yet.** The manifest has no icons (Chrome shows its default letter) and still says "Browser Agent". `icons/` is ready to drop in.
- **16 px pupils** are about one pixel. Fine in Chrome's toolbar; check on a real low-DPI screen.
- **White letters aren't thinned.** White on dark looks slightly bolder. Only matters for big signage.
