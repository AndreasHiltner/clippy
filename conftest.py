import sys
from pathlib import Path

# The plugin package IS this repo's root (dash/ with __init__.py + mood.py + ...).
# pytest's rootdir is dash/ itself, so "import dash" resolves only when the
# PARENT dir is on sys.path (dash is a package, not a module inside one).
sys.path.insert(0, str(Path(__file__).parent.parent))
