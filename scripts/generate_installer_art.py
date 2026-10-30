"""Generate the branded NSIS header and sidebar bitmaps.

Run after regenerating the app icon set:

    python scripts/generate_installer_art.py
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


def font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for name in names:
        path = FONT_DIR / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(height):
        mix = y / max(1, height - 1)
        color = tuple(round(top[i] * (1 - mix) + bottom[i] * mix) for i in range(3))
        for x in range(width):
            pixels[x, y] = color
    return image


def add_glow(
    base: Image.Image,
    center: tuple[int, int],
    radius: int,
    color: tuple[int, int, int, int],
) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse(
        (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
        fill=color,
    )
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.45))
    base.alpha_composite(layer)


def paste_icon(base: Image.Image, box: tuple[int, int, int, int], radius: int) -> None:
    size = (box[2] - box[0], box[3] - box[1])
    icon = Image.open(ICON).convert("RGBA")
    icon.thumbnail((size[0] * 2, size[1] * 2), Image.Resampling.LANCZOS)
    icon = icon.resize(size, Image.Resampling.LANCZOS)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    base.paste(icon, (box[0], box[1]), mask)


def draw_sidebar() -> Image.Image:
    width, height = SIDEBAR_SIZE[0] * SCALE, SIDEBAR_SIZE[1] * SCALE
    base = vertical_gradient((width, height), (12, 16, 38), (20, 12, 37)).convert("RGBA")
    add_glow(base, (int(width * 0.1), int(height * 0.1)), int(width * 0.7), (58, 118, 255, 118))
    add_glow(base, (int(width * 1.02), int(height * 0.85)), int(width * 0.65), (140, 74, 235, 92))
    add_glow(base, (int(width * 0.92), int(height * 0.18)), int(width * 0.25), (255, 172, 121, 48))

    # A soft glass disc behind the mark.
    disc = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(disc)
    margin = 34 * SCALE
    draw.ellipse((margin, 35 * SCALE, width - margin, 35 * SCALE + width - margin * 2),
                 fill=(255, 255, 255, 18), outline=(255, 255, 255, 28), width=1 * SCALE)
    base.alpha_composite(disc)

    paste_icon(
        base,
        (int(width / 2) - 34 * SCALE, 51 * SCALE, int(width / 2) + 34 * SCALE, 119 * SCALE),
        16 * SCALE,
    )

    draw = ImageDraw.Draw(base)
    title = font(["segoeuil.ttf", "segoeui.ttf"], 27 * SCALE)
    subtitle = font(["seguisb.ttf", "segoeui.ttf"], 7 * SCALE)
    footnote = font(["segoeui.ttf", "seguisb.ttf"], 6 * SCALE)

    def centered(text: str, y: int, face: ImageFont.FreeTypeFont, fill: tuple[int, int, int, int]) -> None:
        bounding = draw.textbbox((0, 0), text, font=face)
        x = (width - (bounding[2] - bounding[0])) / 2 - bounding[0]
        draw.text((x, y), text, font=face, fill=fill)

    centered("MrTyper", 134 * SCALE, title, (247, 248, 255, 245))
    centered("HUMAN-PACED TYPING", 174 * SCALE, subtitle, (179, 191, 250, 170))

    draw.line(
        (34 * SCALE, 216 * SCALE, 130 * SCALE, 216 * SCALE),
        fill=(255, 255, 255, 30),
        width=1 * SCALE,
    )
    centered("Type into any window.", 227 * SCALE, footnote, (228, 234, 255, 120))
    centered("Every pause, yours.", 238 * SCALE, footnote, (228, 234, 255, 92))

    # Subtle edge highlight.
    draw.rounded_rectangle(
        (0, 0, width - 1, height - 1),
        radius=0,
        outline=(255, 255, 255, 25),
        width=1 * SCALE,
    )
    return base.convert("RGB").resize(SIDEBAR_SIZE, Image.Resampling.LANCZOS)


def draw_header() -> Image.Image:
    width, height = HEADER_SIZE[0] * SCALE, HEADER_SIZE[1] * SCALE
    base = vertical_gradient((width, height), (12, 17, 38), (23, 15, 42)).convert("RGBA")
    add_glow(base, (0, 0), int(width * 0.8), (63, 126, 255, 106))
    add_glow(base, (width, height), int(width * 0.6), (144, 76, 235, 66))

    paste_icon(base, (8 * SCALE, 8 * SCALE, 48 * SCALE, 48 * SCALE), 11 * SCALE)

    draw = ImageDraw.Draw(base)
    title = font(["seguisb.ttf", "segoeui.ttf"], 15 * SCALE)
    subtitle = font(["segoeui.ttf"], 6 * SCALE)
    draw.text((56 * SCALE, 13 * SCALE), "MrTyper", font=title, fill=(247, 248, 255, 245))
    draw.text(
        (56 * SCALE, 34 * SCALE),
        "Human-paced typing for Windows",
        font=subtitle,
        fill=(206, 216, 255, 185),
    )
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
