#!/usr/bin/env python3
"""Verify every deployed Pages file against deployment.json."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import time
import urllib.parse
import urllib.request


def fetch(url: str, attempts: int = 4) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "NatureWxLab-atmospheric-optics-verifier/1.0"})
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}")
                return response.read()
        except Exception as error:  # noqa: BLE001
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2)
    raise RuntimeError(f"failed to fetch {url}: {last_error}") from last_error


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--manifest-attempts", type=int, default=24)
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/") + "/"

    deployment = None
    for attempt in range(args.manifest_attempts):
        candidate = json.loads(fetch(urllib.parse.urljoin(base_url, "deployment.json")).decode("utf-8"))
        if candidate.get("source_commit") == args.source_commit:
            deployment = candidate
            break
        if attempt + 1 < args.manifest_attempts:
            time.sleep(10)
    if deployment is None:
        raise AssertionError("deployed source commit did not advance to the requested commit")

    def verify(item: tuple[str, dict[str, int | str]]) -> tuple[str, int]:
        path, expected = item
        raw = fetch(urllib.parse.urljoin(base_url, path))
        if len(raw) != expected["bytes"]:
            raise AssertionError(f"deployed byte count mismatch: {path}")
        if hashlib.sha256(raw).hexdigest() != expected["sha256"]:
            raise AssertionError(f"deployed checksum mismatch: {path}")
        return path, len(raw)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        verified = list(executor.map(verify, deployment["files"].items()))
    print(json.dumps({
        "status": "ok",
        "source_commit": deployment["source_commit"],
        "verified_file_count": len(verified),
        "verified_bytes": sum(size for _, size in verified),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
