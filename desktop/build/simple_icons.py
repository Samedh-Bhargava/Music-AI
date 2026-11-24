#!/usr/bin/env python3
"""Generate ICO from SVG using PIL (if possible) or create minimal placeholder."""
from pathlib import Path
import sys

ASSETS_DIR = Path(__file__).resolve().parent.parent / 'assets'

def generate_ico():
    """Generate Windows ICO file using PIL."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("Pillow not available")
        return False

    # Create a simple icon programmatically since we can't convert SVG easily
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    images = []

    for size in sizes:
        img = Image.new('RGBA', size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Draw a simple music note icon
        # Green background circle
        margin = size[0] // 8
        draw.ellipse([margin, margin, size[0]-margin, size[1]-margin], fill=(47, 116, 89, 255))

        # Draw music note
        cx, cy = size[0] // 2, size[1] // 2
        note_color = (255, 255, 255, 255)

        # Stem
        stem_x = cx + size[0] // 6
        draw.rectangle([stem_x, cy - size[1]//3, stem_x + max(1, size[0]//16), cy + size[1]//3], fill=note_color)

        # Note head (oval)
        head_w = max(2, size[0]//4)
        head_h = max(2, size[1]//5)
        draw.ellipse([stem_x - head_w, cy + size[1]//4, stem_x, cy + size[1]//4 + head_h], fill=note_color)

        # Flag for eighth note (smaller sizes)
        if size[0] >= 32:
            flag_points = [
                (stem_x, cy - size[1]//3),
                (stem_x + size[0]//4, cy - size[1]//3),
                (stem_x + size[0]//4, cy - size[1]//3 + size[1]//6),
                (stem_x, cy - size[1]//3 + size[1]//6),
            ]
            draw.polygon(flag_points, fill=note_color)

        images.append(img)

    if images:
        images[0].save(
            ASSETS_DIR / 'icon.ico',
            format='ICO',
            sizes=[(img.width, img.height) for img in images],
            append_images=images[1:]
        )
        print(f"Generated {ASSETS_DIR / 'icon.ico'}")
        return True
    return False

def generate_icns_placeholder():
    """Create a placeholder ICNS file (empty) for macOS build."""
    if sys.platform != 'darwin':
        print("Not on macOS, skipping ICNS generation")
        return

    icns_path = ASSETS_DIR / 'icon.icns'
    # Create minimal valid ICNS (just a header)
    with open(icns_path, 'wb') as f:
        f.write(b'icns')  # magic
        f.write(b'\x00\x00\x00\x00')  # placeholder size
    print(f"Created placeholder {icns_path}")

if __name__ == '__main__':
    print("Generating simple icons...")
    generate_ico()
    generate_icns_placeholder()
    print("Done!")