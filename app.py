"""
Backward-compatible Streamlit entrypoint for ``streamlit run app.py``.

The canonical app lives in ``apps/streamlit_app.py``; this file only forwards.
Prefer: ``streamlit run apps/streamlit_app.py``
"""
from __future__ import annotations

from pathlib import Path

import runpy

def main() -> None:
    root = Path(__file__).resolve().parent
    runpy.run_path(str(root / "apps" / "streamlit_app.py"), run_name="__main__")


if __name__ == "__main__":
    main()
