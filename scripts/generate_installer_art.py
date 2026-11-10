"""Generate the branded NSIS header and sidebar bitmaps.

Run after regenerating the app icon set:

    python scripts/generate_installer_art.py

Requires Pillow:  python -m pip install pillow
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
ICON = ICONS / "icon-512.png"
FONT_DIR = Path("C:/Windows/Fonts")

SIDEBAR_SIZE = (164, 314)
HEADER_SIZE = (150, 57)
SCALE = 4

# The app's design tokens (src/styles/tokens.css).
BG = (8, 9, 10)
SURFACE = (15, 16, 18)
LINE = (38, 40, 44)
TEXT = (241, 242, 236)
TEXT_2 = (168, 171, 162)
TEXT_3 = (114, 117, 109)
ACCENT = (200, 255, 46)


def font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for name in names:
        path = FONT_DIR / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def accent_wash(base: Image.Image, center: tuple[int, int], radius: int, alpha: int) -> None:
    """The faint accent glow that sits in the app window's corners."""
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
        fill=(*ACCENT, alpha),
    )
    base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(radius * 0.5)))


def dot_grid(base: Image.Image, pitch: int, top: int, bottom: int) -> None:
    """The script stage's dot grid, fading out downwards."""
    draw = ImageDraw.Draw(base)
    width = base.size[0]
    span = max(1, bottom - top)
    for y in range(top, bottom, pitch):
        alpha = round(30 * (1 - (y - top) / span))
        if alpha <= 0:
            continue
        for x in range(pitch // 2, width, pitch):
            draw.ellipse((x - SCALE // 2, y - SCALE // 2, x + SCALE // 2, y + SCALE // 2),
                         fill=(255, 255, 255, alpha))


def paste_icon(base: Image.Image, box: tuple[int, int, int, int]) -> None:
    size = (box[2] - box[0], box[3] - box[1])
    icon = Image.open(ICON).convert("RGBA").resize(size, Image.Resampling.LANCZOS)
    base.alpha_composite(icon, (box[0], box[1]))


def cadence_bars(draw: ImageDraw.ImageDraw, left: int, right: int, baseline: int, height: int) -> None:
    """A strip of rhythm bars, like the cadence scope in the app."""
    levels = [0.62, 0.7, 0.55, 0.8, 0.66, 0.74, 0.3, 0.68, 0.85, 0.6, 0.72, 0.5,
              0.78, 0.64, 0.9, 0.58, 0.12, 0.7, 0.76, 0.62, 0.82, 0.55, 0.69, 0.73]
    pitch = 6 * SCALE
    bar = 3 * SCALE
    count = (right - left) // pitch
    for index in range(count):
        level = levels[index % len(levels)]
        x = left + index * pitch
        top = baseline - round(height * level)
        # Fade the oldest bars, as the live scope does.
        alpha = round(255 * (0.25 + 0.75 * index / max(1, count - 1)))
        color = (255, 83, 64, alpha) if index == count - 4 else (*ACCENT, alpha)
        draw.rounded_rectangle((x, top, x + bar, baseline), radius=bar // 2, fill=color)


def draw_sidebar() -> Image.Image:
    width, height = SIDEBAR_SIZE[0] * SCALE, SIDEBAR_SIZE[1] * SCALE
    base = Image.new("RGBA", (width, height), (*BG, 255))
    accent_wash(base, (width, height), int(width * 0.9), 26)
    accent_wash(base, (0, 0), int(width * 0.6), 12)
    dot_grid(base, 12 * SCALE, 10 * SCALE, 104 * SCALE)

    draw = ImageDraw.Draw(base)
    margin = 18 * SCALE

    # Accent kicker, like the page headings in the app.
    draw.rectangle((margin, 30 * SCALE, margin + 9 * SCALE, 31 * SCALE + SCALE), fill=ACCENT)
    kicker = font(["consolab.ttf", "consola.ttf", "segoeui.ttf"], 6 * SCALE)
    draw.text((margin + 14 * SCALE, 27 * SCALE), "SETUP", font=kicker, fill=TEXT_3)

    paste_icon(base, (margin, 46 * SCALE, margin + 52 * SCALE, 98 * SCALE))

    title = font(["seguibl.ttf", "segoeuib.ttf", "segoeui.ttf"], 25 * SCALE)
    draw.text((margin - SCALE, 108 * SCALE), "MrTyper", font=title, fill=TEXT)

    tagline = font(["segoeui.ttf"], 7 * SCALE)
    draw.text((margin, 143 * SCALE), "Human-paced typing", font=tagline, fill=TEXT_2)
    draw.text((margin, 153 * SCALE), "for any window.", font=tagline, fill=TEXT_2)

    # Blinking-cursor motif after the last line of copy.
    caret_x = margin + round(draw.textlength("for any window.", font=tagline)) + 2 * SCALE
    draw.rectangle((caret_x, 154 * SCALE, caret_x + 2 * SCALE, 162 * SCALE), fill=ACCENT)

    cadence_bars(draw, margin, width - margin, 262 * SCALE, 34 * SCALE)
    draw.line((margin, 263 * SCALE + SCALE, width - margin, 263 * SCALE + SCALE),
              fill=(*LINE, 255), width=SCALE)

    mono = font(["consola.ttf", "segoeui.ttf"], 5 * SCALE + 2)
    draw.text((margin, 274 * SCALE), "LOCAL ONLY  ·  NO ACCOUNTS", font=mono, fill=TEXT_3)

    # Right-hand edge, separating the art from the installer page.
    draw.line((width - SCALE, 0, width - SCALE, height), fill=(*LINE, 255), width=SCALE)
    return base.convert("RGB").resize(SIDEBAR_SIZE, Image.Resampling.LANCZOS)


def draw_header() -> Image.Image:
    width, height = HEADER_SIZE[0] * SCALE, HEADER_SIZE[1] * SCALE
    base = Image.new("RGBA", (width, height), (*SURFACE, 255))
    accent_wash(base, (width, height), int(width * 0.55), 22)

    paste_icon(base, (10 * SCALE, 12 * SCALE, 43 * SCALE, 45 * SCALE))

    draw = ImageDraw.Draw(base)
    title = font(["seguibl.ttf", "segoeuib.ttf", "segoeui.ttf"], 15 * SCALE)
    draw.text((51 * SCALE, 11 * SCALE), "MrTyper", font=title, fill=TEXT)
    mono = font(["consola.ttf", "segoeui.ttf"], 5 * SCALE + 2)
    draw.text((52 * SCALE, 34 * SCALE), "HUMAN-PACED TYPING", font=mono, fill=TEXT_3)
    draw.rectangle((52 * SCALE, 44 * SCALE, 64 * SCALE, 44 * SCALE + SCALE), fill=ACCENT)
    return base.convert("RGB").resize(HEADER_SIZE, Image.Resampling.LANCZOS)


def main() -> None:
    if not ICON.exists():
        raise SystemExit(f"Missing source icon: {ICON}")
    ICONS.mkdir(parents=True, exist_ok=True)
    draw_sidebar().save(ICONS / "installer-sidebar.bmp")
    draw_header().save(ICONS / "installer-header.bmp")
    print("Generated installer-sidebar.bmp and installer-header.bmp")


if __name__ == "__main__":
    main()
