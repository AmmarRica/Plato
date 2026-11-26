"""Plato the Foodie Philosopher: local server (Python standard library only).

Serves the pages in web/ and a small JSON API under /api/.
Run:  python server.py     (or ./start.ps1 on Windows)
"""
import base64
import hmac
import json
import mimetypes
import os
import re
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from plato import ask, env, share, takeout              # noqa: E402
from plato.geocode import GeocodeError, Geocoder        # noqa: E402
from plato.store import Store, new_id, now_iso          # noqa: E402

env.load_env(os.path.join(ROOT, ".env"))
WEB_DIR = os.path.join(ROOT, "web")
STYLE_DIR = os.path.join(ROOT, "style-guide")
EXPORTS_DIR = os.path.join(ROOT, "exports")
CSS_FILE = os.path.join(STYLE_DIR, "plato-bootstrap.css")
DATA_FILE = env.get("PLATO_DATA", os.path.join(ROOT, "data", "plato.json"))
MAX_BODY = 60 * 1024 * 1024
PASSWORD = env.get("PLATO_PASSWORD")     # set it to use Plato from a phone or a cloud host

STORE = Store(DATA_FILE)
GEOCODER = Geocoder(STORE)
JOBS = {}                 # import previews waiting for confirmation
JOBS_LOCK = threading.Lock()
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def parse_multipart(content_type, body):
    """Binary-safe multipart/form-data parser -> [(filename, bytes)]."""
    match = re.search(r'boundary="?([^";]+)"?', content_type or "")
    if not match:
        raise ApiError(400, "expected multipart/form-data")
    files = []
    for part in body.split(b"--" + match.group(1).encode("latin-1")):
        head, sep, data = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        name = re.search(rb'filename="([^"]*)"', head)
        if name and name.group(1):
            if data.endswith(b"\r\n"):
                data = data[:-2]
            files.append((name.group(1).decode("utf-8", "replace"), data))
    return files


def run_import(job, rows):
    def progress(done, total):
        job["progress"] = {"done": done, "total": total}
    try:
        job["preview"] = takeout.build_preview(STORE.snapshot(), rows, GEOCODER, progress)
        job["state"] = "done"
    except Exception as err:                    # keep the server alive, report in the UI
        job["state"], job["error"] = "error", str(err)


def job_view(job):
    view = {k: job[k] for k in ("id", "state", "progress", "warnings", "files", "error")}
    if job["state"] == "done":
        view.update(job["preview"])
    return dict(view, ok=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "Plato/1.0"
    protocol_version = "HTTP/1.1"

    # ----- plumbing -----
    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") or self.path.startswith("/s/"):
            sys.stderr.write(f"[plato] {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}\n")

    def send_body(self, status, body, ctype):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, obj, status=200):
        self.send_body(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "upload too large")
        return self.rfile.read(length) if length else b""

    def read_json(self):
        try:
            data = json.loads(self.read_body().decode("utf-8") or "{}")
        except ValueError:
            raise ApiError(400, "request body is not valid JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "request body must be a JSON object")
        return data

    def is_local(self):
        host = self.client_address[0]
        return host.startswith("127.") or host in ("::1", "::ffff:127.0.0.1")

    def authorized(self):
        """HTTP Basic auth: any user name, password = PLATO_PASSWORD."""
        kind, _, token = (self.headers.get("Authorization") or "").partition(" ")
        if kind.lower() != "basic":
            return False
        try:
            given = base64.b64decode(token).decode("utf-8").partition(":")[2]
        except (ValueError, UnicodeDecodeError):
            return False
        return hmac.compare_digest(given.encode("utf-8"), PASSWORD.encode("utf-8"))

    def send_file(self, base, rel):
        full = os.path.realpath(os.path.join(base, rel.lstrip("/")))
        if not full.startswith(os.path.realpath(base) + os.sep) or not os.path.isfile(full):
            raise ApiError(404, "not found")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype == "application/javascript":
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            self.send_body(200, fh.read(), ctype)

    def dispatch(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        try:
            self.route(self.command, path)
        except ApiError as err:
            self.send_json({"ok": False, "error": err.message}, err.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as err:
            sys.stderr.write(f"[plato] error on {self.command} {path}: {err!r}\n")
            self.send_json({"ok": False, "error": f"server error: {err}"}, 500)

    do_GET = do_HEAD = do_POST = do_PUT = dispatch

    # ----- routes -----
    def route(self, method, path):
        read = method in ("GET", "HEAD")
        # Shared pages (and the files they need) are the only thing other
        # machines may see when the server is opened up with PLATO_HOST.
        if read and path.startswith("/s/"):
            return self.shared_page(path[3:].strip("/"))
        if read and path.startswith("/style-guide/"):
            return self.send_file(STYLE_DIR, path[len("/style-guide/"):])
        if read and path.startswith("/vendor/"):
            return self.send_file(WEB_DIR, path)
        if PASSWORD:
            if not self.authorized():
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="Plato", charset="UTF-8"')
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        elif not self.is_local():
            raise ApiError(403, "only shared pages are available remotely (set PLATO_PASSWORD to allow more)")

        if path.startswith("/api/"):
            return self.api(method, path[5:].strip("/"))
        if not read:
            raise ApiError(405, "method not allowed")
        if path.startswith("/exports/"):
            return self.send_file(EXPORTS_DIR, path[len("/exports/"):])
        return self.send_file(WEB_DIR, "index.html" if path in ("/", "") else path)

    def api(self, method, name):
        if name == "data" and method in ("GET", "HEAD"):
            return self.send_json(STORE.snapshot())
        if name == "data" and method == "PUT":
            try:
                STORE.replace(self.read_json())
            except ValueError as err:
                raise ApiError(400, str(err))
            return self.send_json({"ok": True, "saved_at": now_iso()})
        if name == "config" and method == "GET":
            return self.send_json({"ok": True, "ai": ask.available()})
        if name == "geocode" and method == "POST":
            return self.geocode()
        if name == "import" and method == "POST":
            return self.import_start()
        if name == "import/commit" and method == "POST":
            return self.import_commit()
        if name.startswith("import/") and method == "GET":
            job = JOBS.get(name[7:])
            if not job:
                raise ApiError(404, "import preview not found (server restarted?)")
            return self.send_json(job_view(job))
        if name.startswith("share/") and method == "POST":
            return self.share_list(name[6:])
        if name == "ask" and method == "POST":
            return self.ask_plato()
        raise ApiError(404, f"no such endpoint: {method} /api/{name}")

    def geocode(self):
        query = str(self.read_json().get("q") or "").strip()
        if not query:
            raise ApiError(400, "q is required")
        try:
            hit = GEOCODER.lookup(query)
        except GeocodeError as err:
            raise ApiError(502, str(err))
        self.send_json({"ok": True, "q": query, "lat": hit.get("lat"), "lng": hit.get("lng"),
                        "results": hit.get("results", []), "cached": hit.get("cached", False)})

    def import_start(self):
        files = parse_multipart(self.headers.get("Content-Type"), self.read_body())
        if not files:
            raise ApiError(400, "no files uploaded")
        rows, warnings, used = takeout.parse_files(files)
        job = {"id": new_id("im"), "state": "running", "error": "", "warnings": warnings,
               "files": used, "progress": {"done": 0, "total": len(rows)}, "preview": None}
        with JOBS_LOCK:
            JOBS.clear()                         # one pending import at a time
            JOBS[job["id"]] = job
        threading.Thread(target=run_import, args=(job, rows), daemon=True).start()
        self.send_json(job_view(job))

    def import_commit(self):
        body = self.read_json()
        job = JOBS.get(str(body.get("import_id") or ""))
        if not job or job["state"] != "done":
            raise ApiError(409, "import preview is not ready")
        skip = [i for i in body.get("skip") or [] if isinstance(i, int)]
        summary = STORE.update(lambda doc: takeout.commit(doc, job["preview"], skip))
        with JOBS_LOCK:
            JOBS.pop(job["id"], None)
        self.send_json({"ok": True, "summary": summary, "data": STORE.snapshot()})

    def share_list(self, list_id):
        def mark(doc):
            lst = next((l for l in doc["lists"] if l["id"] == list_id), None)
            if not lst:
                raise ApiError(404, "list not found")
            if not share.SLUG_RE.match(lst.get("share_slug") or ""):
                lst["share_slug"] = share.unique_slug(doc, lst.get("name"), lst["id"])
            lst["is_shared"] = True
            return lst, share.export(doc, lst, EXPORTS_DIR, CSS_FILE)
        lst, path = STORE.update(mark)
        self.send_json({"ok": True, "slug": lst["share_slug"], "url": f"/s/{lst['share_slug']}",
                        "path": os.path.relpath(path, ROOT).replace(os.sep, "/"),
                        "download": f"/exports/{lst['share_slug']}.html", "data": STORE.snapshot()})

    def shared_page(self, slug):
        doc = STORE.snapshot()
        lst = next((l for l in doc["lists"] if l.get("is_shared") and l.get("share_slug") == slug), None)
        if not lst:
            return self.send_body(404, b"<h1>Not found</h1><p>This list is not shared.</p>",
                                  "text/html; charset=utf-8")
        self.send_body(200, share.render(doc, lst).encode("utf-8"), "text/html; charset=utf-8")

    def ask_plato(self):
        if not ask.available():
            raise ApiError(404, "Ask Plato is not set up (no API key)")
        body = self.read_json()
        question = str(body.get("question") or "").strip()
        if not question:
            raise ApiError(400, "question is required")
        history = body.get("history") if isinstance(body.get("history"), list) else []
        try:
            answer = ask.ask(STORE.snapshot(), question, history)
        except RuntimeError as err:
            raise ApiError(502, str(err))
        self.send_json({"ok": True, "answer": answer})


def main():
    host = env.get("PLATO_HOST", "127.0.0.1")
    port = int(env.get("PLATO_PORT") or env.get("PORT", "8765"))   # cloud hosts set PORT
    os.makedirs(EXPORTS_DIR, exist_ok=True)
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    print("Plato the Foodie Philosopher: the unexamined meal is not worth eating.")
    print(f"  http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}/")
    print(f"  data: {DATA_FILE}   Ask Plato: {'on' if ask.available() else 'off (no API key)'}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye.")


if __name__ == "__main__":
    main()
