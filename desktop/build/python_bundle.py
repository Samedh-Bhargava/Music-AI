#!/usr/bin/env python3
"""
Build script to create a minimal Python distribution for the Sonora desktop app.
Uses uv to create a lightweight virtual environment with only necessary packages.
"""

import os
import sys
import shutil
import subprocess
import platform
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DESKTOP_DIR = Path(__file__).resolve().parent.parent
PYTHON_DIST_DIR = DESKTOP_DIR / 'python' / 'dist'
SERVER_DIR = PROJECT_ROOT / 'server'

def run_cmd(cmd, cwd=None, env=None):
    """Run a command and return result."""
    print(f"Running: {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, shell=isinstance(cmd, str))
    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
        raise RuntimeError(f"Command failed with exit code {result.returncode}")
    return result

def create_python_bundle():
    """Create a minimal Python environment with required packages."""
    print("Creating Python bundle...")

    # Clean previous build
    if PYTHON_DIST_DIR.exists():
        shutil.rmtree(PYTHON_DIST_DIR)
    PYTHON_DIST_DIR.mkdir(parents=True, exist_ok=True)

    # Check if uv is available
    try:
        run_cmd(['uv', '--version'])
    except FileNotFoundError:
        print("uv not found, installing...")
        run_cmd([sys.executable, '-m', 'pip', 'install', 'uv'])

    # Create virtual environment using uv
    venv_dir = PYTHON_DIST_DIR / 'venv'
    run_cmd(['uv', 'venv', str(venv_dir), '--python', '3.13'])

    # Determine python executable
    if platform.system() == 'Windows':
        python_exe = venv_dir / 'Scripts' / 'python.exe'
        pip_exe = venv_dir / 'Scripts' / 'pip.exe'
    else:
        python_exe = venv_dir / 'bin' / 'python'
        pip_exe = venv_dir / 'bin' / 'pip'

    # Install core dependencies with minimal versions
    core_deps = [
        'fastapi==0.115.12',
        'uvicorn[standard]==0.34.0',
        'python-multipart==0.0.20',
        'httpx==0.28.1',
        'defusedxml==0.7.1',
        'numpy==1.26.4',
        'basic-pitch==0.4.0',
        'yt-dlp>=2025.1.0',
    ]

    print("Installing core dependencies...")
    run_cmd([str(pip_exe), 'install', '--no-cache-dir'] + core_deps)

    # Install additional dependencies for audio processing
    audio_deps = [
        'librosa==0.10.2',
        'soundfile==0.12.1',
    ]
    run_cmd([str(pip_exe), 'install', '--no-cache-dir'] + audio_deps)

    # Copy server code to the bundle
    server_bundle_dir = PYTHON_DIST_DIR / 'server'
    shutil.copytree(SERVER_DIR, server_bundle_dir, dirs_exist_ok=True)

    # Create entry point script
    entry_script = PYTHON_DIST_DIR / 'run_server.py'
    entry_script.write_text('''#!/usr/bin/env python3
import sys
import os

# Add server directory to path
server_dir = os.path.join(os.path.dirname(__file__), 'server')
sys.path.insert(0, server_dir)

# Import and run the main module
from main import app
import uvicorn

if __name__ == "__main__":
    # Pass through all arguments to main.py's parser
    sys.argv[0] = os.path.join(server_dir, 'main.py')
    exec(open(os.path.join(server_dir, 'main.py')).read())
''')

    # Make executable on Unix
    if platform.system() != 'Windows':
        entry_script.chmod(0o755)

    print("Python bundle created successfully!")
    print(f"Location: {PYTHON_DIST_DIR}")

    # Print size
    total_size = sum(f.stat().st_size for f in PYTHON_DIST_DIR.rglob('*') if f.is_file())
    print(f"Total size: {total_size / (1024*1024):.1f} MB")

if __name__ == '__main__':
    create_python_bundle()