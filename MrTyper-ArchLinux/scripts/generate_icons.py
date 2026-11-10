"""Create Tauri icon sizes from the glass source artwork.

Run from the project root after replacing src-tauri/icons/icon.png:

    python scripts/generate_icons.py

Requires Pillow:  python -m pip install pillow
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
SOURCE = ICONS / "icon.png"

SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "256x256.png": 256,
    "icon-512.png": 512,
}


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source artwork: {SOURCE}")

    master = Image.open(SOURCE).convert("RGBA")
    if master.width != master.height:
        edge = max(master.width, master.height)
        canvas = Image.new("RGBA", (edge, edge), (0, 0, 0, 0))
        canvas.alpha_composite(
            master,
            ((edge - master.width) // 2, (edge - master.height) // 2),
        )
        master = canvas

    for filename, size in SIZES.items():
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(ICONS / filename, optimize=True)

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.resize((256, 256), Image.Resampling.LANCZOS).save(
        ICONS / "icon.ico",
        format="ICO",
        sizes=ico_sizes,
    )
    print(f"Generated {len(SIZES)} PNG sizes and icon.ico in {ICONS}")


if __name__ == "__main__":
    main()
