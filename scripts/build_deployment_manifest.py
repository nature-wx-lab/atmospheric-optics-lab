#!/usr/bin/env python3
"""Create a checksum manifest for the exact GitHub Pages payload."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="dist")
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        raise SystemExit("source commit must be a full lowercase SHA-1")
    if not root.is_dir() or root.is_symlink():
        raise SystemExit("site root must be a real directory")

    files: dict[str, dict[str, int | str]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise SystemExit(f"symlink is not allowed: {path.relative_to(root)}")
        if not path.is_file() or path.name == "deployment.json":
            continue
        relative = path.relative_to(root).as_posix()
        raw = path.read_bytes()
        files[relative] = {
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }

    payload = {
        "schema_version": 1,
        "product": "atmospheric-optics-lab",
        "source_commit": args.source_commit,
        "files": files,
    }
    destination = root / "deployment.json"
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "ok", "source_commit": args.source_commit, "files": len(files)}))


if __name__ == "__main__":
    main()
