#!/usr/bin/env python3
"""Generate PNG and ICO/ICNS icons from SVG."""
from pathlib import Path
import subprocess
import sys

ASSETS_DIR = Path(__file__).resolve().parent.parent / 'assets'
SVG_PATH = ASSETS_DIR / 'icon.svg'

# Check if we have cairosvg or pillow
try:
    import cairosvg
    HAS_CAIROSVG = True
except ImportError:
    HAS_CAIROSVG = False

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

def generate_png():
    """Generate PNG icons at various sizes."""
    sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

    if HAS_CAIROSVG:
        for size in sizes:
            output_path = ASSETS_DIR / f'icon-{size}.png'
            cairosvg.svg2png(url=str(SVG_PATH), write_to=str(output_path), output_width=size, output_height=size)
            print(f"Generated {output_path}")

        # Main icon.png
        cairosvg.svg2png(url=str(SVG_PATH), write_to=str(ASSETS_DIR / 'icon.png'), output_width=512, output_height=512)
        print(f"Generated {ASSETS_DIR / 'icon.png'}")
    elif HAS_PILLOW:
        # Try using wand or other ImageMagick bindings
        try:
            from wand.image import Image as WandImage
            for size in sizes:
                with WandImage(filename=str(SVG_PATH)) as img:
                    img.resize(size, size)
                    img.save(filename=str(ASSETS_DIR / f'icon-{size}.png'))
            with WandImage(filename=str(SVG_PATH)) as img:
                img.resize(512, 512)
                img.save(filename=str(ASSETS_DIR / 'icon.png'))
        except ImportError:
            print("No suitable image library found. Please install cairosvg or wand.")
            return False
    else:
        print("No image library available. Installing cairosvg...")
        subprocess.run([sys.executable, '-m', 'pip', 'install', 'cairosvg'], check=True)
        import cairosvg
        for size in sizes:
            output_path = ASSETS_DIR / f'icon-{size}.png'
            cairosvg.svg2png(url=str(SVG_PATH), write_to=str(output_path), output_width=size, output_height=size)
        cairosvg.svg2png(url=str(SVG_PATH), write_to=str(ASSETS_DIR / 'icon.png'), output_width=512, output_height=512)
    return True

def generate_ico():
    """Generate Windows ICO file."""
    if not HAS_PILLOW:
        try:
            from PIL import Image
        except ImportError:
            print("Pillow not available, skipping ICO generation")
            return

    try:
        from PIL import Image
        sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        images = []
        for size in sizes:
            img_path = ASSETS_DIR / f'icon-{size[0]}.png'
            if img_path.exists():
                images.append(Image.open(img_path))

        if images:
            images[0].save(
                ASSETS_DIR / 'icon.ico',
                format='ICO',
                sizes=[(img.width, img.height) for img in images],
                append_images=images[1:]
            )
            print(f"Generated {ASSETS_DIR / 'icon.ico'}")
    except Exception as e:
        print(f"ICO generation failed: {e}")

def generate_icns():
    """Generate macOS ICNS file (requires iconutil on macOS)."""
    if sys.platform != 'darwin':
        print("ICNS generation only works on macOS, skipping")
        return

    iconset_dir = ASSETS_DIR / 'icon.iconset'
    iconset_dir.mkdir(exist_ok=True)

    # Required sizes for ICNS
    icns_sizes = {
        'icon_16x16.png': 16,
        'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32,
        'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128,
        'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256,
        'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512,
        'icon_512x512@2x.png': 1024,
    }

    if HAS_CAIROSVG:
        for filename, size in icns_sizes.items():
            cairosvg.svg2png(
                url=str(SVG_PATH),
                write_to=str(iconset_dir / filename),
                output_width=size,
                output_height=size
            )

    # Run iconutil
    try:
        subprocess.run(['iconutil', '-c', 'icns', str(iconset_dir), '-o', str(ASSETS_DIR / 'icon.icns')], check=True)
        print(f"Generated {ASSETS_DIR / 'icon.icns'}")
        # Cleanup
        import shutil
        shutil.rmtree(iconset_dir)
    except subprocess.CalledProcessError as e:
        print(f"iconutil failed: {e}")

if __name__ == '__main__':
    print("Generating icons...")
    generate_png()
    generate_ico()
    generate_icns()
    print("Done!")