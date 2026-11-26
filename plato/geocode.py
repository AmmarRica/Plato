"""Nominatim geocoding: cached in the JSON file, at most 1 request per second."""
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import env
from .store import now_iso

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
MIN_INTERVAL = 1.1          # seconds between requests (policy: max 1 per second)
NEGATIVE_TTL_DAYS = 7       # retry "not found" answers after a week


class GeocodeError(Exception):
    """Network or service failure (as opposed to 'no match')."""


def user_agent():
    contact = env.get("PLATO_CONTACT")
    extra = f"; contact: {contact}" if contact else ""
    return f"PlatoFoodMap/1.0 (personal food map, single user{extra})"


def cache_key(query):
    return " ".join(str(query or "").lower().split())


class Geocoder:
    def __init__(self, store, fetch=None):
        self.store = store
        self.fetch = fetch or self._fetch
        self._gate = threading.Lock()
        self._last = 0.0

    def _fetch(self, params):
        url = NOMINATIM_URL + "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"User-Agent": user_agent(),
                                                   "Accept-Language": "en"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as err:
            raise GeocodeError(f"Nominatim request failed: {err}") from err

    def cached(self, query):
        entry = self.store.doc.get("geocode_cache", {}).get(cache_key(query))
        if not entry:
            return None
        if entry.get("lat") is None:
            try:
                from datetime import datetime
                age = datetime.now().astimezone() - datetime.fromisoformat(entry["at"])
                if age.days >= NEGATIVE_TTL_DAYS:
                    return None
            except (KeyError, ValueError, TypeError):
                return None
        return entry

    def lookup(self, query, cached_only=False):
        """Return {"lat","lng","display_name","results","cached"}; lat is None
        when nothing matched. Returns None for cached_only cache misses."""
        key = cache_key(query)
        if not key:
            return {"lat": None, "lng": None, "results": [], "cached": True}
        hit = self.cached(key)
        if hit:
            return dict(hit, cached=True)
        if cached_only:
            return None
        with self._gate:                       # one request at a time, spaced out
            hit = self.cached(key)
            if hit:
                return dict(hit, cached=True)
            wait = MIN_INTERVAL - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            params = {"q": query, "format": "jsonv2", "limit": 5}
            settings = self.store.doc.get("settings", {})
            lat, lng = settings.get("home_lat") or 0, settings.get("home_lng") or 0
            if lat or lng:                     # prefer matches near home, don't require them
                params["viewbox"] = f"{lng - 0.6},{lat + 0.6},{lng + 0.6},{lat - 0.6}"
                params["bounded"] = 0
            try:
                rows = self.fetch(params)
            finally:
                self._last = time.monotonic()
        results = []
        for row in rows if isinstance(rows, list) else []:
            try:
                results.append({"lat": float(row["lat"]), "lng": float(row["lon"]),
                                "name": row.get("name") or "",
                                "display_name": row.get("display_name") or ""})
            except (KeyError, TypeError, ValueError):
                continue
        first = results[0] if results else {}
        entry = {"lat": first.get("lat"), "lng": first.get("lng"), "at": now_iso(),
                 "display_name": first.get("display_name", ""), "results": results}
        self.store.update(lambda doc: doc["geocode_cache"].__setitem__(key, entry))
        return dict(entry, cached=False)
