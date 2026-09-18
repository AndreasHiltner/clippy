import sys
from pathlib import Path

# The plugin package IS this repo's root (clippy/ with __init__.py + mood.py + ...).
# pytest's rootdir is clippy/ itself, so "import clippy" resolves only when the
# PARENT dir is on sys.path (clippy is a package, not a module inside one).
sys.path.insert(0, str(Path(__file__).parent.parent))
