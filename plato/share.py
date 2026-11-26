"""Read-only shared maps: the /s/<slug> page and the self-contained HTML export.

Only public fields ever leave this module; private notes are never copied.
"""
import html
import json
import os
import re

from .store import atomic_write, now_iso

PUBLIC_FIELDS = ("name", "address", "lat", "lng", "google_maps_url", "tags", "price",
                 "rating", "status", "notes_public", "must_order")
LEAFLET_CDN = "https://unpkg.com/leaflet@1.9.4/dist"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:60].strip("-")
    return slug or "list"


def unique_slug(doc, text, exclude_id=None):
    base = slugify(text)
    taken = {l.get("share_slug") for l in doc["lists"] if l.get("id") != exclude_id}
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


def public_payload(doc, lst):
    """Everything a shared page may show, and nothing else."""
    places = {p["id"]: p for p in doc["places"]}
    items = sorted((i for i in doc["list_items"] if i["list_id"] == lst["id"]),
                   key=lambda i: i.get("added_at") or "", reverse=True)
    rows, used = [], set()
    for item in items:
        place = places.get(item["place_id"])
        if not place:
            continue
        row = {field: place.get(field) for field in PUBLIC_FIELDS}
        row["added_at"] = item.get("added_at")
        row["note"] = item.get("note") or ""
        rows.append(row)
        used.update(place.get("tags") or [])
    return {"list": {"name": lst.get("name", ""), "description": lst.get("description", ""),
                     "color": lst.get("color") or "#d9534f"},
            "places": rows,
            "tags": [t for t in doc["tags"] if t["name"] in used],
            "generated_at": now_iso()}


def _embed(payload):
    # "<" is escaped so the JSON can never close the <script> element.
    return json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")


def render(doc, lst, css_text=None):
    """Build the page. With css_text the result is self-contained (CSS inlined,
    Leaflet from unpkg); without it the page uses the app's own local files."""
    title = f"{lst.get('name', '')} · Plato's picks"
    if css_text is None:
        assets = ('<link rel="stylesheet" href="/style-guide/plato-bootstrap.css">\n'
                  '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">\n'
                  '<script src="/vendor/leaflet/leaflet.js"></script>')
    else:
        assets = (f"<style>{css_text}</style>\n"
                  f'<link rel="stylesheet" href="{LEAFLET_CDN}/leaflet.css">\n'
                  f'<script src="{LEAFLET_CDN}/leaflet.js"></script>')
    return (PAGE.replace("__TITLE__", html.escape(title))
            .replace("__ASSETS__", assets)
            .replace("__DATA__", _embed(public_payload(doc, lst))))


def export(doc, lst, exports_dir, css_path):
    """Write exports/<slug>.html and return its path."""
    slug = lst.get("share_slug") or ""
    if not SLUG_RE.match(slug):
        raise ValueError("list has no valid share slug")
    try:
        with open(css_path, "r", encoding="utf-8") as fh:
            css_text = fh.read().replace("</style", "<\\/style")
    except OSError:
        css_text = ""
    path = os.path.join(exports_dir, f"{slug}.html")
    atomic_write(path, render(doc, lst, css_text=css_text))
    return path


PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
__ASSETS__
<style>
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column}
.sh-head{padding:10px 16px;border-bottom:1px solid #ddd;border-top:4px solid var(--c,#d9534f);background:#fff}
.sh-head h1{font-size:22px;margin:0 0 2px}
.sh-head p{margin:0;color:#777}
.sh-body{flex:1;display:flex;min-height:0}
.sh-list{width:340px;max-width:40%;overflow:auto;border-right:1px solid #ddd;background:#fafafa}
.sh-item{padding:10px 14px;border-bottom:1px solid #eee;cursor:pointer}
.sh-item:hover,.sh-item.on{background:#fff7e0}
.sh-item h4{margin:0 0 3px;font-size:15px}
.sh-item small{color:#888}
#map{flex:1;min-height:260px}
.chip{display:inline-block;padding:1px 7px;margin:1px 2px 1px 0;border-radius:10px;font-size:11px;color:#fff}
.stars{color:#f0ad4e;letter-spacing:1px}
.sh-pin{width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.sh-foot{padding:5px 16px;font-size:11px;color:#999;border-top:1px solid #eee;background:#fff}
@media (max-width:700px){.sh-body{flex-direction:column-reverse}.sh-list{width:auto;max-width:none;flex:1;border-right:0}#map{flex:none;height:45vh}}
</style>
</head>
<body>
<div class="sh-head" id="head"></div>
<div class="sh-body"><div class="sh-list" id="list"></div><div id="map"></div></div>
<div class="sh-foot">Plato the Foodie Philosopher · the unexamined meal is not worth eating</div>
<script id="plato-data" type="application/json">__DATA__</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('plato-data').textContent);
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var tagMap = {}; data.tags.forEach(function (t) { tagMap[t.name] = t; });
  var color = /^#[0-9a-f]{3,8}$/i.test(data.list.color) ? data.list.color : '#d9534f';
  var safeUrl = function (u) { return /^https?:\/\//i.test(u || '') ? u : ''; };
  var fmt = function (iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    return new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric'}).format(d);
  };
  var chips = function (p) { return (p.tags || []).map(function (n) {
    var t = tagMap[n] || {}; var c = /^#[0-9a-f]{3,8}$/i.test(t.color || '') ? t.color : '#777';
    return '<span class="chip" style="background:' + c + '">' + esc((t.icon ? t.icon + ' ' : '') + n) + '</span>'; }).join(''); };
  var meta = function (p) {
    var bits = [];
    if (p.rating) bits.push('<span class="stars">' + '★★★★★'.slice(0, p.rating) + '</span>');
    if (p.price) bits.push('$$$$'.slice(0, p.price));
    return bits.join(' · ');
  };
  var details = function (p) {
    var h = '<strong>' + esc(p.name) + '</strong><br>' + chips(p);
    if (meta(p)) h += '<div>' + meta(p) + '</div>';
    if (p.notes_public) h += '<div>' + esc(p.notes_public) + '</div>';
    if (p.note) h += '<div><em>' + esc(p.note) + '</em></div>';
    if ((p.must_order || []).length) h += '<div><b>Must order:</b> ' + esc(p.must_order.join(', ')) + '</div>';
    if (p.address) h += '<div style="color:#888">' + esc(p.address) + '</div>';
    if (safeUrl(p.google_maps_url)) h += '<a href="' + esc(p.google_maps_url) + '" target="_blank" rel="noopener">Open in Google Maps</a>';
    return h;
  };
  document.documentElement.style.setProperty('--c', color);
  document.getElementById('head').innerHTML = '<h1>' + esc(data.list.name) + '</h1><p>' +
    esc(data.list.description || '') + (data.list.description ? ' · ' : '') + data.places.length + ' places · Plato\'s picks</p>';
  var listEl = document.getElementById('list');
  listEl.innerHTML = data.places.map(function (p, i) {
    return '<div class="sh-item" data-i="' + i + '"><h4>' + esc(p.name) + '</h4>' + chips(p) +
      (meta(p) ? '<div>' + meta(p) + '</div>' : '') +
      (p.notes_public ? '<div>' + esc(p.notes_public) + '</div>' : '') +
      '<small>Added ' + esc(fmt(p.added_at)) + '</small></div>'; }).join('') ||
    '<div class="sh-item">No places yet.</div>';
  if (!window.L) { document.getElementById('map').innerHTML = '<p style="padding:20px">Map needs an internet connection.</p>'; return; }
  var map = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  var icon = L.divIcon({className: '', iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -22],
    html: '<div class="sh-pin" style="background:' + color + '"></div>'});
  var markers = [], pts = [];
  data.places.forEach(function (p, i) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
    markers[i] = L.marker([p.lat, p.lng], {icon: icon, title: p.name}).addTo(map).bindPopup(details(p));
    pts.push([p.lat, p.lng]);
  });
  if (pts.length) map.fitBounds(pts, {padding: [40, 40], maxZoom: 15}); else map.setView([39.9526, -75.1652], 12);
  listEl.addEventListener('click', function (ev) {
    var el = ev.target.closest('.sh-item'); if (!el || !markers[el.dataset.i]) return;
    var m = markers[el.dataset.i]; map.setView(m.getLatLng(), Math.max(map.getZoom(), 15)); m.openPopup();
  });
})();
</script>
</body>
</html>
"""
