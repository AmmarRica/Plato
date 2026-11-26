"""Build web/vendor/basemap/basemap.json, the offline fallback map.

Build-time only (the app itself never needs this). Requires:  pip install shapely
Inputs (download into one folder first):
  Natural Earth 1:10m GeoJSON (public domain) from
    https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
    ne_10m_land, ne_10m_lakes, ne_10m_rivers_lake_centerlines, ne_10m_rivers_north_america,
    ne_10m_roads, ne_10m_admin_1_states_provinces_lines, ne_10m_urban_areas,
    ne_10m_populated_places_simple   (saved as <name>.json)
  optional neighborhoods.geojson: polygons with a name property, for street-level context

Usage: python tools/build_basemap.py <input-folder> [west south east north]
"""
import json
import os
import sys

from shapely.geometry import box, mapping, shape

src = sys.argv[1]
bbox = [float(v) for v in sys.argv[2:6]] or [-77.2, 38.7, -73.6, 41.2]
region = box(*bbox)
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "vendor", "basemap", "basemap.json")


def load(name):
    path = os.path.join(src, name)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["features"]


def rounded(obj, digits):
    if isinstance(obj, (list, tuple)):
        return [rounded(v, digits) for v in obj]
    return round(obj, digits) if isinstance(obj, float) else obj


def clip(name, keep=None, simplify=0.0, digits=4, props=lambda p: {}):
    out = []
    for feat in load(name):
        p = feat.get("properties") or {}
        if not feat.get("geometry") or (keep and not keep(p)):
            continue
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        if not geom.intersects(region):
            continue
        geom = geom.intersection(region)
        if simplify:
            geom = geom.simplify(simplify, preserve_topology=True)
        if geom.is_empty:
            continue
        g = mapping(geom)
        out.append({"type": "Feature", "properties": props(p),
                    "geometry": {"type": g["type"], "coordinates": rounded(g["coordinates"], digits)}})
    return out


def centroid_points(features):
    pts = []
    for feat in features:
        c = shape(feat["geometry"]).representative_point()
        pts.append({"name": feat["properties"]["name"], "lat": round(c.y, 5), "lng": round(c.x, 5)})
    return pts


name_of = lambda p: {"name": p.get("LISTNAME") or p.get("MAPNAME") or p.get("name") or p.get("NAME") or ""}
hoods = clip("neighborhoods.geojson", simplify=0.00008, digits=5, props=name_of)
layers = {
    "land": clip("ne_10m_land.json"),
    "urban": clip("ne_10m_urban_areas.json", simplify=0.002),
    "lakes": clip("ne_10m_lakes.json"),
    "rivers": clip("ne_10m_rivers_lake_centerlines.json") + clip("ne_10m_rivers_north_america.json"),
    "states": clip("ne_10m_admin_1_states_provinces_lines.json"),
    "roads": clip("ne_10m_roads.json", keep=lambda p: p.get("featurecla") != "Ferry",
                  props=lambda p: {"major": p.get("type") in ("Major Highway", "Beltway")}),
    "hoods": hoods,
}
places = [{"name": f["properties"].get("name"), "lat": round(f["geometry"]["coordinates"][1], 4),
           "lng": round(f["geometry"]["coordinates"][0], 4), "big": (f["properties"].get("pop_max") or 0) > 400000}
          for f in load("ne_10m_populated_places_simple.json")
          if region.contains(shape(f["geometry"]))]
doc = {"bbox": bbox, "layers": layers, "places": places, "hood_labels": centroid_points(hoods),
       "sources": "Natural Earth (public domain); Philadelphia neighborhoods via OpenDataPhilly"}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
print({k: len(v) for k, v in layers.items()}, "places", len(places), "bytes", os.path.getsize(OUT))
