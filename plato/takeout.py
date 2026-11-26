"""Google Takeout importer (Maps saved lists + Saved Places).

Inputs understood:
  Saved/*.csv                          one CSV per saved list (Title, Note, URL, Tags, Comment)
  Maps (your places)/Saved Places.json GeoJSON with coordinates, address and a saved date
  a Takeout .zip containing either of the above

Command line:  python -m plato.takeout <path> [--data data/plato.json] [--dry-run] [--yes]
The web UI calls parse_files / build_preview / commit from this same module.
"""
import argparse
import csv
import io
import json
import math
import os
import re
import sys
import urllib.parse
import zipfile
from datetime import datetime, timezone

from .share import unique_slug
from .store import PALETTE, TZ, Store, new_id, norm_tag, now_iso

# A Takeout list name that should land on an existing list with another name.
LIST_ALIASES = {
    "favorite places": ["loved", "favorites", "favourites"],
    "favourite places": ["loved", "favorites", "favourites"],
    "favorites": ["loved", "favorite places"],
    "saved places": ["starred places", "starred"],
}
DUP_METERS = 50


# ---------- reading files ----------

def read_inputs(path):
    """Collect (name, bytes) pairs from a folder, a .zip or a single file."""
    files = []
    if os.path.isdir(path):
        for root, _dirs, names in os.walk(path):
            for name in sorted(names):
                if name.lower().endswith((".csv", ".json", ".zip")):
                    full = os.path.join(root, name)
                    with open(full, "rb") as fh:
                        files.append((os.path.relpath(full, path), fh.read()))
    else:
        with open(path, "rb") as fh:
            files.append((os.path.basename(path), fh.read()))
    return expand_zips(files)


def expand_zips(files):
    out = []
    for name, data in files:
        if name.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    for info in zf.infolist():
                        if not info.is_dir() and info.filename.lower().endswith((".csv", ".json")):
                            out.append((info.filename, zf.read(info)))
            except zipfile.BadZipFile:
                out.append((name, b""))
        else:
            out.append((name, data))
    return out


def parse_date(value):
    """Any ISO-ish date -> ISO-8601 in America/New_York, or None."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(TZ).isoformat(timespec="seconds")


def parse_url(url):
    """Pull whatever a Google Maps URL gives away: name, feature id, cid, coordinates."""
    out = {"name": "", "ftid": "", "cid": "", "pid": "", "lat": None, "lng": None}
    url = str(url or "").strip()
    if not url:
        return out
    match = re.search(r"/maps/place/([^/@?]+)", url)
    if match:
        out["name"] = urllib.parse.unquote_plus(match.group(1)).strip()
    match = re.search(r"(0x[0-9a-fA-F]+):(0x[0-9a-fA-F]+)", url)
    if match:
        out["ftid"] = f"{match.group(1)}:{match.group(2)}".lower()
        out["cid"] = str(int(match.group(2), 16))
    match = re.search(r"[?&]cid=(\d+)", url)
    if match:
        out["cid"] = match.group(1)
    match = re.search(r"(?:query_place_id=|place_id[:=])(ChI[\w-]+)", url)
    if match:
        out["pid"] = match.group(1)
    for pattern in (r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", r"@(-?\d+\.\d+),(-?\d+\.\d+)",
                    r"/search/(-?\d+\.\d+),\+?(-?\d+\.\d+)", r"[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)"):
        match = re.search(pattern, url)
        if match:
            out["lat"], out["lng"] = float(match.group(1)), float(match.group(2))
            break
    return out


def _coords(lat, lng):
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None, None
    if (lat == 0 and lng == 0) or abs(lat) > 90 or abs(lng) > 180:
        return None, None
    return lat, lng


def _row(source_file, kind, list_name, name, url, **extra):
    info = parse_url(url)
    row = {"source_file": source_file, "kind": kind, "list_name": list_name,
           "name": (name or info["name"] or "").strip(), "url_name": info["name"],
           "address": "", "lat": info["lat"], "lng": info["lng"], "url": (url or "").strip(),
           "place_id": info["ftid"] or info["pid"] or (f"cid:{info['cid']}" if info["cid"] else ""),
           "key": f"cid:{info['cid']}" if info["cid"] else (f"pid:{info['pid']}" if info["pid"] else ""),
           "note": "", "comment": "", "tags": [], "saved_at": None, "rating": None}
    row.update({k: v for k, v in extra.items() if v not in (None, "")})
    return row


def parse_csv(name, data):
    """One saved-list CSV. Rows normally have no coordinates."""
    text = data.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines)
                  if re.match(r'\s*"?title"?\s*,', line, re.I)), None)
    if start is None:
        return None
    list_name = os.path.splitext(os.path.basename(name.replace("\\", "/")))[0].strip()
    rows = []
    for raw in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        rec = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items() if k is not None}
        if not rec.get("title") and not rec.get("url"):
            continue
        tags = [norm_tag(t) for t in re.split(r"[;,|]", rec.get("tags", "")) if norm_tag(t)]
        rows.append(_row(name, "csv", list_name, rec.get("title"), rec.get("url"),
                         note=rec.get("note"), comment=rec.get("comment"), tags=tags))
    return rows


def parse_geojson(name, data):
    """Saved Places.json (and other Takeout GeoJSON such as Reviews.json)."""
    try:
        doc = json.loads(data.decode("utf-8-sig", errors="replace"))
    except ValueError:
        return None
    if not isinstance(doc, dict) or not isinstance(doc.get("features"), list):
        return None
    list_name = os.path.splitext(os.path.basename(name.replace("\\", "/")))[0].strip()
    rows = []
    for feat in doc["features"]:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties") or {}
        loc = props.get("location") or props.get("Location") or {}
        url = props.get("google_maps_url") or props.get("Google Maps URL") or ""
        geo = (feat.get("geometry") or {}).get("coordinates") or [None, None]
        lat, lng = _coords(geo[1] if len(geo) > 1 else None, geo[0] if geo else None)
        if lat is None:
            alt = loc.get("Geo Coordinates") or {}
            lat, lng = _coords(alt.get("Latitude"), alt.get("Longitude"))
        address = loc.get("address") or loc.get("Address") or ""
        title = (loc.get("name") or loc.get("Business Name") or props.get("Title")
                 or props.get("name") or "")
        row = _row(name, "geojson", list_name, title, url, address=address,
                   saved_at=parse_date(props.get("date") or props.get("Published") or props.get("Updated")),
                   comment=props.get("Comment") or props.get("review_text_published"),
                   rating=props.get("five_star_rating_published"))
        if lat is not None:
            row["lat"], row["lng"] = lat, lng
        if not row["name"]:
            row["name"] = address.split(",")[0].strip() or "Dropped pin"
        rows.append(row)
    return rows


def parse_files(files):
    """Turn (name, bytes) pairs into import rows. GeoJSON first: it has coordinates."""
    rows, warnings, used = [], [], []
    ordered = sorted(expand_zips(files), key=lambda f: (not f[0].lower().endswith(".json"), f[0]))
    for name, data in ordered:
        lower = name.lower()
        parsed = parse_geojson(name, data) if lower.endswith(".json") else (
            parse_csv(name, data) if lower.endswith(".csv") else None)
        if parsed is None:
            if lower.endswith(".csv") or "saved places" in lower:
                warnings.append(f"{name}: not a recognised Takeout file, skipped")
            continue
        used.append({"name": name, "rows": len(parsed)})
        rows.extend(parsed)
    if not rows:
        warnings.append("No places found. Expected Saved/*.csv or Maps (your places)/Saved Places.json.")
    for i, row in enumerate(rows):
        row["i"] = i
    return rows, warnings, used


# ---------- duplicates ----------

def meters(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 6371000 * 2 * math.asin(math.sqrt(a))


def _norm_url(url):
    return re.sub(r"^https?://(www\.)?", "", str(url or "").strip().lower()).rstrip("/")


def _norm_name(name):
    return re.sub(r"[^a-z0-9]+", " ", str(name or "").lower()).strip()


def _keys(url, place_id):
    info = parse_url(url)
    more = parse_url(place_id) if place_id else {"cid": "", "pid": ""}
    keys = set()
    pid = str(place_id or "")
    cid = info["cid"] or more["cid"] or (pid[4:] if pid.startswith("cid:") else "")
    if cid:
        keys.add(f"cid:{cid}")
    for value in (info["pid"], more["pid"], pid if pid.startswith("ChI") else ""):
        if value:
            keys.add(f"pid:{value}")
    if url:
        keys.add(f"url:{_norm_url(url)}")
    return keys


class _Index:
    """Known places (already saved, plus earlier rows of this import)."""

    def __init__(self, places):
        self.entries = []
        for place in places:
            self.add({"place_id": place["id"]}, place.get("name"), place.get("lat"), place.get("lng"),
                     place.get("google_maps_url"), place.get("google_place_id"))

    def add(self, target, name, lat, lng, url, place_id):
        self.entries.append({"target": target, "name": _norm_name(name), "lat": lat, "lng": lng,
                             "keys": _keys(url, place_id)})

    def by_key(self, row):
        keys = _keys(row["url"], row["place_id"])
        return next((e["target"] for e in self.entries if keys & e["keys"]), None)

    def by_position(self, row):
        if row["lat"] is None:
            return None
        name = _norm_name(row["name"])
        for entry in self.entries:
            if (entry["name"] == name and entry["lat"] is not None
                    and meters(row["lat"], row["lng"], entry["lat"], entry["lng"]) <= DUP_METERS):
                return entry["target"]
        return None


def find_list(doc, name):
    wanted = [name.strip().lower()] + LIST_ALIASES.get(name.strip().lower(), [])
    for candidate in wanted:
        for lst in doc["lists"]:
            if lst.get("name", "").strip().lower() == candidate:
                return lst
    return None


def build_preview(doc, rows, geocoder=None, progress=None):
    """Classify every row as new / duplicate / failed (to geocode).
    Rows without coordinates are geocoded through the cache (1 request/second)."""
    index = _Index(doc["places"])
    on_list = {(i["list_id"], i["place_id"]) for i in doc["list_items"]}
    total, offline = len(rows), ""
    for n, row in enumerate(rows):
        row.update(status="new", detail="", match_id=None, same_as=None, list_action="add")
        target = index.by_key(row)
        if offline:
            row["detail"] = offline
        if target is None and row["lat"] is None and geocoder is not None and not offline:
            for query in dict.fromkeys(q for q in (row["name"], row["url_name"]) if q):
                try:
                    hit = geocoder.lookup(query)
                except Exception as err:          # network down: leave for the Needs pin queue
                    row["detail"] = offline = f"geocoding unavailable ({err})"[:160]
                    break
                if hit and hit.get("lat") is not None:
                    row["lat"], row["lng"] = hit["lat"], hit["lng"]
                    row["address"] = row["address"] or hit.get("display_name", "")
                    row["geocoded"] = True
                    break
        if target is None:
            target = index.by_position(row)
        if target is not None:
            row["status"] = "duplicate"
            row["match_id"], row["same_as"] = target.get("place_id"), target.get("row")
            row["detail"] = ("already in Plato" if row["match_id"]
                             else f"same place as row {row['same_as'] + 1}")
            lst = find_list(doc, row["list_name"])
            if lst and row["match_id"] and (lst["id"], row["match_id"]) in on_list:
                row["list_action"] = "already"
                row["detail"] += ", already on this list"
        else:
            if row["lat"] is None:
                row["status"] = "failed"
                row["detail"] = row["detail"] or "could not geocode; goes to Needs pin"
            index.add({"row": row["i"]}, row["name"], row["lat"], row["lng"], row["url"], row["place_id"])
        if progress:
            progress(n + 1, total)
    counts = {key: sum(1 for r in rows if r["status"] == key) for key in ("new", "duplicate", "failed")}
    names = list(dict.fromkeys(r["list_name"] for r in rows))
    lists = [{"name": name, "exists": bool(find_list(doc, name)),
              "target": (find_list(doc, name) or {}).get("name", name),
              "rows": sum(1 for r in rows if r["list_name"] == name)} for name in names]
    return {"rows": rows, "counts": counts, "lists": lists}


# ---------- commit ----------

def _status_for(list_name):
    return "want_to_try" if re.search(r"want to (go|try)", list_name, re.I) else "recommend"


def commit(doc, preview, skip=()):
    """Apply a preview to the document. Existing added_at values are never touched."""
    now = now_iso()
    skip = set(skip)
    by_id = {p["id"]: p for p in doc["places"]}
    made, summary = {}, {"places_added": 0, "items_added": 0, "lists_created": 0, "needs_pin": 0}
    for row in preview["rows"]:
        if row["i"] in skip:
            continue
        lst = find_list(doc, row["list_name"])
        if lst is None:
            lst = {"id": new_id("ls"), "name": row["list_name"], "description": "",
                   "color": PALETTE[len(doc["lists"]) % len(PALETTE)],
                   "share_slug": unique_slug(doc, row["list_name"]), "is_shared": False,
                   "created_at": now}
            doc["lists"].append(lst)
            summary["lists_created"] += 1
        notes = "\n".join(t for t in (row["note"], row["comment"]) if t)
        place = by_id.get(row["match_id"]) or by_id.get(made.get(row["same_as"]))
        if place is None:
            place = {"id": new_id("pl"), "name": row["name"] or "Unnamed place",
                     "address": row["address"], "lat": row["lat"], "lng": row["lng"],
                     "google_maps_url": row["url"], "google_place_id": row["place_id"],
                     "tags": list(row["tags"]), "price": None, "rating": row.get("rating"),
                     "status": _status_for(row["list_name"]), "notes_public": "",
                     "notes_private": notes, "must_order": [], "source": "google_takeout",
                     "created_at": now, "updated_at": now}
            if row["lat"] is None:
                place["needs_pin"] = True
                summary["needs_pin"] += 1
            doc["places"].append(place)
            by_id[place["id"]] = place
            summary["places_added"] += 1
        else:                                   # duplicate: only fill in blanks
            changed = False
            for field, value in (("address", row["address"]), ("google_maps_url", row["url"]),
                                 ("google_place_id", row["place_id"])):
                if value and not place.get(field):
                    place[field], changed = value, True
            if place.get("lat") is None and row["lat"] is not None:
                place["lat"], place["lng"], changed = row["lat"], row["lng"], True
                place.pop("needs_pin", None)
            if notes and notes not in (place.get("notes_private") or ""):
                place["notes_private"] = "\n".join(t for t in (place.get("notes_private"), notes) if t)
                changed = True
            if changed:
                place["updated_at"] = now
        made[row["i"]] = place["id"]
        if not any(i["list_id"] == lst["id"] and i["place_id"] == place["id"] for i in doc["list_items"]):
            item = {"list_id": lst["id"], "place_id": place["id"],
                    "added_at": row["saved_at"] or now, "note": ""}
            if not row["saved_at"]:
                item["added_at_estimated"] = True
            doc["list_items"].append(item)
            summary["items_added"] += 1
    return summary


# ---------- command line ----------

def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m plato.takeout",
                                     description="Import Google Takeout saved places into Plato.")
    parser.add_argument("path", help="Takeout folder, .zip, .csv or Saved Places.json")
    parser.add_argument("--data", default=os.path.join("data", "plato.json"))
    parser.add_argument("--dry-run", action="store_true", help="show the preview, change nothing")
    parser.add_argument("--no-geocode", action="store_true", help="skip Nominatim lookups")
    parser.add_argument("--yes", action="store_true", help="commit without asking")
    args = parser.parse_args(argv)

    from . import env
    from .geocode import Geocoder
    env.load_env()
    store = Store(args.data)
    rows, warnings, used = parse_files(read_inputs(args.path))
    for item in used:
        print(f"  read {item['rows']:4d} rows  {item['name']}")
    for warning in warnings:
        print(f"  ! {warning}")
    if not rows:
        return 1
    need = sum(1 for r in rows if r["lat"] is None)
    if need and not args.no_geocode:
        print(f"Geocoding up to {need} places (cached; 1 request/second)...")

    def progress(done, total):
        print(f"\r  {done}/{total}", end="", flush=True)

    preview = build_preview(store.doc, rows, None if args.no_geocode else Geocoder(store), progress)
    print()
    for row in preview["rows"]:
        print(f"  {row['status']:9s} {row['name'][:38]:38s} -> {row['list_name'][:24]:24s} {row['detail']}")
    counts = preview["counts"]
    print(f"\n{counts['new']} new, {counts['duplicate']} duplicate, {counts['failed']} failed to geocode")
    if args.dry_run:
        return 0
    if not args.yes and input("Import these? [y/N] ").strip().lower() not in ("y", "yes"):
        print("Nothing imported.")
        return 0
    summary = store.update(lambda doc: commit(doc, preview))
    print(f"Imported: {summary['places_added']} places, {summary['items_added']} list entries, "
          f"{summary['lists_created']} new lists, {summary['needs_pin']} need a pin.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
