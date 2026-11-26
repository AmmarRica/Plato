"""Tiny .env reader (standard library only).

Lines look like KEY=value. Blank lines and lines starting with # are ignored.
Values already present in the real environment win over the file.
"""
import os


def load_env(path=".env"):
    """Read KEY=value pairs from `path` into os.environ. Returns the pairs read."""
    found = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return found
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        found[key] = value
        os.environ.setdefault(key, value)
    return found


def get(name, default=""):
    """Read one setting, treating an empty value as missing."""
    value = os.environ.get(name, "")
    return value if value.strip() else default
