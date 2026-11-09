#!/usr/bin/env python3
"""Crop raw screenshots (white background) to the artifact and save square
WebP thumbnails into OUT_DIR/thumbs.

    python crop_thumbs.py RAW_DIR OUT_DIR [--size 192]
"""
import argparse
from pathlib import Path

from PIL import Image, ImageChops


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--size", type=int, default=192)
    args = ap.parse_args()
    (args.out / "thumbs").mkdir(parents=True, exist_ok=True)
    for f in sorted(args.raw.glob("*.png")):
        im = Image.open(f).convert("RGB")
        mask = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255)))
        box = mask.convert("L").point(lambda v: 255 if v > 12 else 0).getbbox()
        if not box:
            print(f"skip {f.name}: empty render")
            continue
        x0, y0, x1, y1 = box
        cx, cy, half = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 1.1 / 2
        square = Image.new("RGB", (int(2 * half), int(2 * half)), (255, 255, 255))
        square.paste(im, (int(half - cx), int(half - cy)))
        square.resize((args.size, args.size), Image.LANCZOS).save(
            args.out / "thumbs" / f"{f.stem}.webp", quality=82)


if __name__ == "__main__":
    main()
