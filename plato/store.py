"""The JSON document: defaults, clean-up rules and atomic saving."""
import copy
import json
import os
import re
import secrets
import tempfile
import threading
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/New_York")
except Exception:  # tzdata missing (Windows without the package): fall back to UTC
    TZ = timezone.utc

PALETTE = ["#d9534f", "#5bc0de", "#5cb85c", "#f0ad4e", "#337ab7",
           "#9b59b6", "#e67e22", "#1abc9c", "#e83e8c", "#7f8c8d"]
STATUSES = ("recommend", "want_to_try", "been", "avoid")
# Default home: Philadelphia City Hall. Change it in Settings on the map page.
DEFAULT_SETTINGS = {"home_lat": 39.9526, "home_lng": -75.1652, "default_zoom": 13}


def now_iso():
    """Current time as ISO-8601 with the America/New_York offset."""
    return datetime.now(TZ).isoformat(timespec="seconds")


def new_id(prefix):
    return f"{prefix}_{secrets.token_hex(5)}"


def norm_tag(name):
    return re.sub(r"\s+", " ", str(name or "").strip().lower())


def empty_doc():
    return {"version": 1, "places": [], "lists": [], "list_items": [], "tags": [],
            "geocode_cache": {}, "settings": dict(DEFAULT_SETTINGS)}


def normalize(doc):
    """Enforce the data rules in place: required keys, lowercase unique tags,
    tags created on first use, no list items pointing at missing rows."""
    base = empty_doc()
    for key, value in base.items():
        if not isinstance(doc.get(key), type(value)):
            doc[key] = value
    for key, value in DEFAULT_SETTINGS.items():
        doc["settings"].setdefault(key, value)

    seen, tags = set(), []
    for tag in doc["tags"]:
        name = norm_tag(tag.get("name")) if isinstance(tag, dict) else ""
        if name and name not in seen:
            seen.add(name)
            tags.append({"name": name, "color": tag.get("color") or PALETTE[len(tags) % len(PALETTE)],
                         "icon": tag.get("icon") or ""})
    for place in doc["places"]:
        names = []
        for raw in place.get("tags") or []:
            name = norm_tag(raw)
            if name and name not in names:
                names.append(name)
            if name and name not in seen:
                seen.add(name)
                tags.append({"name": name, "color": PALETTE[len(tags) % len(PALETTE)], "icon": ""})
        place["tags"] = names
        place.setdefault("must_order", [])
    doc["tags"] = tags

    place_ids = {p.get("id") for p in doc["places"]}
    list_ids = {l.get("id") for l in doc["lists"]}
    pairs, items = set(), []
    for item in doc["list_items"]:
        pair = (item.get("list_id"), item.get("place_id"))
        if pair[0] in list_ids and pair[1] in place_ids and pair not in pairs:
            pairs.add(pair)
            items.append(item)
    doc["list_items"] = items
    return doc


def atomic_write(path, text):
    """Write to a temp file, fsync, then os.replace: a crash can't corrupt `path`."""
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".part", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class Store:
    """Thread-safe holder of the one JSON document."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self.doc = empty_doc()
        self.load()

    def load(self):
        with self.lock:
            if not os.path.exists(self.path):
                self.doc = empty_doc()
                self.save()
                return
            try:
                with open(self.path, "r", encoding="utf-8") as fh:
                    self.doc = normalize(json.load(fh))
            except (ValueError, OSError) as err:
                aside = f"{self.path}.corrupt-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
                os.replace(self.path, aside)
                print(f"[plato] {self.path} was unreadable ({err}); moved to {aside}")
                self.doc = empty_doc()
                self.save()

    def save(self):
        with self.lock:
            atomic_write(self.path, json.dumps(self.doc, ensure_ascii=False, indent=1))

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.doc)

    def replace(self, doc):
        """Swap in a whole document from the browser. The geocode cache is
        owned by the server, so the stored one is kept."""
        if not isinstance(doc, dict) or not isinstance(doc.get("places"), list):
            raise ValueError("document must be an object with a places array")
        with self.lock:
            doc = normalize(copy.deepcopy(doc))
            doc["geocode_cache"] = self.doc.get("geocode_cache", {})
            doc["version"] = 1
            self.doc = doc
            self.save()

    def update(self, fn):
        """Run fn(doc) under the lock, tidy the document and save it."""
        with self.lock:
            result = fn(self.doc)
            normalize(self.doc)
            self.save()
            return result
