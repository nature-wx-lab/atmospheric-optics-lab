#!/usr/bin/env python3
"""Fail closed when source, history, or a Pages payload contains private data."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
from pathlib import Path


DEFAULT_ROOT = Path(__file__).resolve().parents[1]
ALLOWED_IDENTITIES = {
    ("nature-wx-lab", "nature-wx-lab@users.noreply.github.com"),
    ("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com"),
}
ALLOWED_EMAILS = {email for _, email in ALLOWED_IDENTITIES}
IGNORED_PARTS = {".git", "node_modules", "dist", "coverage", "tmp"}
FORBIDDEN_NAMES = {".DS_Store", ".env", "Thumbs.db"}
FORBIDDEN_PARTS = {"private", "screenshots", "downloads", "logs", "secrets", "cache"}
FORBIDDEN_SUFFIXES = {
    ".db", ".dmg", ".env", ".gif", ".heic", ".jpeg", ".jpg", ".key", ".log",
    ".mov", ".mp4", ".p12", ".pdf", ".pem", ".pfx", ".png", ".sqlite",
    ".tiff", ".xls", ".xlsx", ".zip",
}
MAX_FILE_BYTES = 12 * 1024 * 1024
PATTERNS = {
    "absolute-user-path": re.compile(r"/" r"Users/|[A-Za-z]:\\\\Users\\\\", re.IGNORECASE),
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "private-key": re.compile(r"-----BEGIN " r"(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github-token": re.compile(r"\b(?:github_" r"pat_|gh[pousr]_)[A-Za-z0-9_]{16,}\b"),
    "aws-access-key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "google-api-key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "credential-assignment": re.compile(
        r"\b(?:api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|auth[_-]?token)\b"
        r"\s*[:=]\s*[\"']?[^\s\"']{8,}",
        re.IGNORECASE,
    ),
}


def git(root: Path, *args: str, text: bool = True) -> str | bytes:
    return subprocess.check_output(["git", "-C", str(root), *args], text=text)


def denylist_values() -> tuple[str, ...]:
    raw = os.environ.get("PRIVACY_DENYLIST", "")
    return tuple(value.strip() for value in raw.splitlines() if len(value.strip()) >= 3)


def scan_text(label: str, text: str, denylist: tuple[str, ...]) -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    for line_number, line in enumerate(text.splitlines(), 1):
        for kind, pattern in PATTERNS.items():
            for match in pattern.finditer(line):
                if kind == "email" and match.group(0).lower() in ALLOWED_EMAILS:
                    continue
                findings.append((label, line_number, kind))
        folded = line.casefold()
        if any(value.casefold() in folded for value in denylist):
            findings.append((label, line_number, "private-denylist"))
    return findings


def scan_bytes(label: str, raw: bytes, denylist: tuple[str, ...]) -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    lower = raw.lower()
    markers = {
        "absolute-user-path": b"/" + b"Users/",
        "private-mail-domain": b"@" + b"gmail.com",
        "private-key": b"-----BEGIN " + b"PRIVATE KEY-----",
        "github-token": b"github_" + b"pat_",
        "github-classic-token": b"gh" + b"p_",
    }
    for kind, marker in markers.items():
        if marker.lower() in lower:
            findings.append((label, 0, kind))
    for value in denylist:
        if value.encode("utf-8").lower() in lower:
            findings.append((label, 0, "private-denylist"))
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return findings
    findings.extend(scan_text(label, text, denylist))
    return findings


def path_problem(path: Path) -> str | None:
    if path.name in FORBIDDEN_NAMES or path.name.startswith(".env."):
        return "forbidden-file"
    if any(part in FORBIDDEN_PARTS for part in path.parts):
        return "forbidden-directory"
    if path.suffix.lower() in FORBIDDEN_SUFFIXES:
        return "forbidden-suffix"
    if path.suffix.lower() == ".map":
        return "source-map"
    return None


def scan_current(root: Path, denylist: tuple[str, ...]) -> tuple[list[tuple[str, int, str]], int]:
    findings: list[tuple[str, int, str]] = []
    count = 0
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part in IGNORED_PARTS for part in relative.parts):
            continue
        if path.is_symlink():
            findings.append((relative.as_posix(), 0, "symlink"))
            continue
        if path.is_dir():
            if any(part in FORBIDDEN_PARTS for part in relative.parts):
                findings.append((relative.as_posix(), 0, "forbidden-directory"))
            continue
        count += 1
        findings.extend(scan_text(f"filename:{relative.as_posix()}", relative.as_posix(), denylist))
        problem = path_problem(relative)
        if problem:
            findings.append((relative.as_posix(), 0, problem))
            continue
        if path.stat().st_size > MAX_FILE_BYTES:
            findings.append((relative.as_posix(), 0, "oversized-file"))
            continue
        findings.extend(scan_bytes(relative.as_posix(), path.read_bytes(), denylist))
    return findings, count


def scan_history(root: Path, denylist: tuple[str, ...]) -> tuple[list[tuple[str, int, str]], int, int]:
    if not (root / ".git").exists():
        return [], 0, 0
    findings: list[tuple[str, int, str]] = []
    commits = 0
    log = str(git(root, "log", "--all", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e"))
    for record in log.split("\x1e"):
        record = record.strip()
        if not record:
            continue
        commits += 1
        parts = record.split("\x1f", 5)
        if len(parts) != 6:
            findings.append(("git-log", 0, "unparseable-commit"))
            continue
        commit, author_name, author_email, committer_name, committer_email, message = parts
        if (author_name, author_email) not in ALLOWED_IDENTITIES:
            findings.append((commit[:12], 0, "disallowed-author-identity"))
        if (committer_name, committer_email) not in ALLOWED_IDENTITIES:
            findings.append((commit[:12], 0, "disallowed-committer-identity"))
        findings.extend(scan_text(f"commit:{commit[:12]}", message, denylist))

    objects = 0
    seen: set[str] = set()
    object_rows = [row for row in str(git(root, "rev-list", "--objects", "--all")).splitlines() if " " in row]
    for row in object_rows:
        object_id, name = row.split(" ", 1)
        if object_id in seen:
            continue
        seen.add(object_id)
        if str(git(root, "cat-file", "-t", object_id)).strip() != "blob":
            continue
        objects += 1
        findings.extend(scan_text(f"historical-filename:{name}", name, denylist))
        problem = path_problem(Path(name))
        if problem:
            findings.append((f"{object_id[:12]}:{name}", 0, f"historical-{problem}"))
            continue
        size = int(str(git(root, "cat-file", "-s", object_id)).strip())
        if size > MAX_FILE_BYTES:
            findings.append((f"{object_id[:12]}:{name}", 0, "historical-oversized-file"))
            continue
        raw = git(root, "cat-file", "blob", object_id, text=False)
        assert isinstance(raw, bytes)
        findings.extend(scan_bytes(f"{object_id[:12]}:{name}", raw, denylist))
    return findings, commits, objects


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--skip-history", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir() or root.is_symlink():
        raise SystemExit("privacy root must be a real directory")

    denylist = denylist_values()
    findings, files = scan_current(root, denylist)
    commits = objects = 0
    if not args.skip_history:
        history_findings, commits, objects = scan_history(root, denylist)
        findings.extend(history_findings)
    if findings:
        for label, line, kind in findings[:80]:
            location = f"{label}:{line}" if line else label
            print(f"PRIVACY BLOCK: {location} [{kind}]")
        if len(findings) > 80:
            print(f"PRIVACY BLOCK: {len(findings) - 80} additional finding(s) hidden")
        raise SystemExit(1)
    print(
        f"privacy gate passed: files={files}, commits={commits}, reachable_blobs={objects}, "
        f"denylist_values={len(denylist)}"
    )


if __name__ == "__main__":
    main()
