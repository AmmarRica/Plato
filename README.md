# Plato the Foodie Philosopher

> The unexamined meal is not worth eating.

A personal food map: a full-size map of the restaurants, cafés and bars you recommend,
organised into lists, labelled with tags, and shareable as read-only maps.
Every time a place is added to a list, the date and time are recorded.

No framework, no build step: Python standard library on the server, plain HTML/CSS/JS in the browser.

## Run

Requires Python 3 (built for 3.14). On Windows:

```powershell
./start.ps1
```

This creates `.venv`, installs `tzdata` and `anthropic` (both optional at runtime), and starts the
server. Open <http://localhost:8765/>.

On macOS/Linux: `python3 server.py`.

| Setting (`.env`, see `.env.example`) | Default | Purpose |
|---|---|---|
| `PLATO_PORT` | `8765` | Port |
| `PLATO_HOST` | `127.0.0.1` | `0.0.0.0` lets other machines open `/s/<slug>` pages only; the app and API stay local |
| `PLATO_CONTACT` | none | Contact added to the Nominatim User-Agent |
| `ANTHROPIC_API_KEY` | none | Turns on "Ask Plato" |
| `PLATO_MODEL` | `claude-opus-5-5` | Model for Ask Plato |

Home location and default zoom: the ⚙ button (defaults to Philadelphia City Hall).

## Screens

| Screen | What it does |
|---|---|
| **Map** | Clustered markers, colored by the selected list (or first tag for "All places"). Filters: search, list, tags (all selected tags must match), status, price, added in the last N days. "+ Add place": search by name/address or click the map. |
| **Lists** | Cards with place count and last-added date; create, edit, delete, reorder (↑ ↓). Detail page: places newest first, small map, per-list notes. |
| **Tags** | Name, color, emoji; merge; usage counts. Tags are lowercase and created on first use. |
| **Timeline** | Every list addition by date, under month headers. |
| **Import** | Google Takeout upload, preview, confirm, and the "Needs pin" queue. |

## Import Google Takeout

1. At <https://takeout.google.com>, export **Saved** and **Maps (your places)**.
2. Open **Import**, upload the `.zip` (or the files inside it):
   - `Saved/*.csv`: one per saved list; the file name becomes the list name.
   - `Maps (your places)/Saved Places.json`: starred places with coordinates and saved dates.
3. Wait for the preview (rows without coordinates are geocoded through Nominatim at 1 request per
   second and cached in `data/plato.json`), check new / duplicate / failed to geocode, then **Confirm import**.
4. Places that could not be geocoded land in **Needs pin**: click "Place on map", then click the spot.

Command line, same module:

```powershell
.venv\Scripts\python -m plato.takeout "C:\path\to\Takeout" --dry-run
```

```powershell
.venv\Scripts\python -m plato.takeout "C:\path\to\takeout.zip" --yes
```

Rules the importer follows:

| Rule | Behaviour |
|---|---|
| Duplicates | Matched by Google place ID / URL first, then same name within 50 m. Duplicates are not copied, only added to the list if missing. |
| `added_at` | Takeout's saved date when present; otherwise the import time with `"added_at_estimated": true`. An existing `added_at` is never overwritten, so re-importing is safe. |
| List names | `Favorite places.csv` goes to an existing "Loved" (or "Favorites") list; "Want to go" places get the status *Want to try*; everything else *Recommend*. |
| Google notes | Stored as the **private** note, so they never appear on shared maps. |

## Share a list

1. **Lists → Share** on a list.
2. You get:
   - a read-only page at `/s/<share_slug>` (live while the server runs), and
   - a self-contained file `exports/<share_slug>.html` (data embedded as JSON, Leaflet from unpkg) to send or host anywhere.
3. Click **Share** again after changes to refresh the file. **Stop sharing** turns the page off.

Shared output contains only public fields: name, address, coordinates, Google Maps link, tags, price,
rating, status, public note, must-order, the per-list note and the added date. Private notes are never included.

## Use it from a phone or a cloud host

By default only this computer can open the app. To open it elsewhere, set a password in `.env`:

```
PLATO_HOST=0.0.0.0
PLATO_PASSWORD=choose-a-long-one
```

| Where | How |
|---|---|
| Phone on the same Wi-Fi | Restart, then open `http://<this-computer's-IP>:8765/`. Any user name, the password above. Plain HTTP: home network only. |
| Cloud host (Render, Fly.io, Railway, Azure App Service...) | Deploy the included `Dockerfile`, set `PLATO_PASSWORD` as a secret, and mount a persistent disk at `/app/data`. The host provides HTTPS. |

### Portainer / Docker

`docker-compose.yml` runs Plato on port 8765 with named volumes for `data/` and `exports/`.

1. Portainer → **Stacks → Add stack → Repository**, point it at this repository, compose path `docker-compose.yml`.
2. Add the environment variable `PLATO_PASSWORD` (and optionally `ANTHROPIC_API_KEY`).
3. **Deploy the stack**, then open `http://<docker-host>:8765/`.

Without Portainer: `PLATO_PASSWORD=choose-a-long-one docker compose up -d --build`.

With a password set, everything except `/s/<slug>` shared pages asks for it.

## Ask Plato (optional)

Put `ANTHROPIC_API_KEY=...` in `.env` and restart. A chat button appears that answers from your saved
places only (public fields; private notes are not sent). Without a key the button stays hidden.

## Offline map

When OpenStreetMap tiles cannot load, a bundled fallback map shows instead: coastline, rivers, state
lines, main roads, towns and Philadelphia neighborhood outlines with names (zoom 13+). It covers
roughly Baltimore to New York. It is an outline map, not street level. Online, the normal tiles cover it.

| File | Purpose |
|---|---|
| `web/vendor/basemap/basemap.json` | The fallback map data (about 330 KB) |
| `tools/build_basemap.py` | Rebuilds it for another area (build-time only; needs `pip install shapely`) |

Sources: Natural Earth (public domain) and the Philadelphia neighborhoods file from OpenDataPhilly's
`open-geo-data` GitHub repository (check its terms before redistributing).

## Data and network

- Everything lives in `data/plato.json`, written atomically (temp file, fsync, `os.replace`).
  The browser keeps a localStorage copy and falls back to it if the server is unreachable.
- Dates are ISO-8601 with a timezone and displayed in America/New_York.
- Network calls: OpenStreetMap tiles, Nominatim, and (only with a key) the Claude API.
  The exported share file additionally loads Leaflet from unpkg.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/data`, `PUT /api/data` | Whole document (the server keeps its own `geocode_cache`) |
| `POST /api/geocode {q}` | Cached, rate-limited Nominatim search |
| `POST /api/import` (multipart), `GET /api/import/<id>`, `POST /api/import/commit {import_id}` | Takeout preview, progress, commit |
| `POST /api/share/<list_id>` | Marks the list shared, writes the export, returns path and URL |
| `GET /s/<slug>` | Read-only shared page |
| `GET /api/config`, `POST /api/ask {question, history}` | Ask Plato availability and chat |

## Layout

```
start.ps1  server.py  requirements.txt
plato/        env.py  store.py  geocode.py  takeout.py  share.py  ask.py
data/         plato.json (gitignored)
exports/      shared HTML files
style-guide/  plato-bootstrap.css
web/          index.html  css/plato.css  js/*.js  vendor/leaflet  vendor/leaflet-markercluster
```

`style-guide/plato-bootstrap.css` is stock Bootstrap 3.4.1. To match Aiden exactly, overwrite it with Aiden's CSS file.
