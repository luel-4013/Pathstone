#!/usr/bin/env python3
"""Pathstone vault server.

Serves the static app and a small JSON API on top of a real SQLite database
file (data/pathstone.db). Standard library only — nothing to install.

Endpoints:
  GET    /api/vault              -> {"record": null | {"savedAt": ..., "state": ...}}
  PUT    /api/vault              <- {"state": ..., "savedAt": ?}  -> {"savedAt": ...}
  GET    /api/snapshots          -> {"records": [{"id","kind","savedAt"}, ...]}
  POST   /api/snapshots          <- {"id": ?, "kind": ..., "state": ...} -> {"id": ...}
  GET    /api/snapshots/<id>     -> {"record": {...} | null}
  DELETE /api/snapshots/<id>     -> {"deleted": true | false}

Everything else is served from the project folder as plain static files.

Environment:
  PORT / PATHSTONE_PORT (default 8247)   bind 127.0.0.1
  PATHSTONE_DB (default data/pathstone.db)
"""

import datetime
import json
import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("PATHSTONE_DB", ROOT / "data" / "pathstone.db")).resolve()
HOST = os.environ.get("PATHSTONE_HOST", "127.0.0.1")
PORT = int(os.environ.get("PATHSTONE_PORT", os.environ.get("PORT", "8247")))
MAX_BODY = 32 * 1024 * 1024

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
}

SAFE_ID = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-")
SAFE_KINDS = {"auto", "manual", "pre"}


class BadRequest(Exception):
    pass


class PayloadTooLarge(Exception):
    pass


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS vault (
            id TEXT PRIMARY KEY,
            saved_at TEXT NOT NULL,
            json TEXT NOT NULL)"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS snapshots (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            saved_at TEXT NOT NULL,
            json TEXT NOT NULL)"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_saved ON snapshots(saved_at)")
    return conn


class PathstoneHandler(BaseHTTPRequestHandler):
    server_version = "PathstoneVault/0.3"

    # ---- plumbing ----

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def read_json(self):
        length_header = self.headers.get("Content-Length") or "0"
        try:
            length = int(length_header)
        except ValueError:
            raise BadRequest("bad content-length")
        if length <= 0:
            raise BadRequest("empty body")
        if length > MAX_BODY:
            raise PayloadTooLarge()
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise BadRequest("body is not valid JSON")

    def log_message(self, fmt, *args):
        sys.stderr.write("[vault] %s %s\n" % (self.command, self.path))

    # ---- SQL helpers ----

    @property
    def db(self):
        return connect()

    def api_get_vault(self):
        with self.db as conn:
            row = conn.execute("SELECT saved_at, json FROM vault WHERE id = 'current'").fetchone()
        record = None
        if row:
            record = {"savedAt": row[0], "state": json.loads(row[1])}
        self.send_json(200, {"record": record})

    def api_put_vault(self):
        data = self.read_json()
        state = data.get("state")
        if not isinstance(state, dict):
            raise BadRequest("missing state")
        saved_at = data.get("savedAt")
        if not isinstance(saved_at, str) or len(saved_at) > 40:
            saved_at = now_iso()
        with self.db as conn:
            conn.execute(
                """INSERT INTO vault (id, saved_at, json) VALUES ('current', ?, ?)
                   ON CONFLICT(id) DO UPDATE SET saved_at = excluded.saved_at, json = excluded.json""",
                (saved_at, json.dumps(state)),
            )
        self.send_json(200, {"savedAt": saved_at})

    def api_list_snapshots(self):
        with self.db as conn:
            rows = conn.execute("SELECT id, kind, saved_at FROM snapshots ORDER BY saved_at DESC").fetchall()
        records = [{"id": row[0], "kind": row[1], "savedAt": row[2]} for row in rows]
        self.send_json(200, {"records": records})

    def api_post_snapshot(self):
        data = self.read_json()
        snap_id = data.get("id")
        kind = data.get("kind")
        state = data.get("state")
        if not isinstance(snap_id, str) or not snap_id or len(snap_id) > 120 or set(snap_id) - SAFE_ID:
            raise BadRequest("bad id")
        if kind not in SAFE_KINDS:
            raise BadRequest("bad kind")
        if not isinstance(state, dict):
            raise BadRequest("missing state")
        saved_at = data.get("savedAt")
        if not isinstance(saved_at, str) or len(saved_at) > 40:
            saved_at = now_iso()
        with self.db as conn:
            conn.execute(
                """INSERT INTO snapshots (id, kind, saved_at, json) VALUES (?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, saved_at = excluded.saved_at, json = excluded.json""",
                (snap_id, kind, saved_at, json.dumps(state)),
            )
        self.send_json(200, {"id": snap_id})

    @staticmethod
    def split_snapshot_path(path):
        parts = path.split("/")
        if len(parts) != 4:
            raise BadRequest("bad snapshot path")
        snap_id = unquote(parts[3])
        if not snap_id or len(snap_id) > 120 or set(snap_id) - SAFE_ID:
            raise BadRequest("bad snapshot id")
        return snap_id

    def api_get_snapshot(self, snap_id):
        with self.db as conn:
            row = conn.execute("SELECT id, kind, saved_at, json FROM snapshots WHERE id = ?", (snap_id,)).fetchone()
        record = None
        if row:
            record = {"id": row[0], "kind": row[1], "savedAt": row[2], "state": json.loads(row[3])}
        self.send_json(200, {"record": record})

    def api_delete_snapshot(self, snap_id):
        with self.db as conn:
            cursor = conn.execute("DELETE FROM snapshots WHERE id = ?", (snap_id,))
            deleted = cursor.rowcount > 0
        self.send_json(200, {"deleted": deleted})

    # ---- routing ----

    def do_GET(self):
        self.route("GET")

    def do_PUT(self):
        self.route("PUT")

    def do_POST(self):
        self.route("POST")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        path = urlparse(self.path).path
        try:
            if path.startswith("/api/"):
                self.handle_api(method, path)
            else:
                self.serve_static(path)
        except BadRequest as error:
            self.send_json(400, {"error": str(error)})
        except PayloadTooLarge:
            self.send_json(413, {"error": "payload too large"})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "invalid JSON"})
        except sqlite3.Error as error:
            self.send_json(503, {"error": "database busy", "detail": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:  # noqa: BLE001 — final guard for the API surface
            sys.stderr.write("[vault] unhandled %r for %s\n" % (error, self.path))
            self.send_json(500, {"error": "internal error"})

    def handle_api(self, method, path):
        if path == "/api/vault":
            if method == "GET":
                return self.api_get_vault()
            if method == "PUT":
                return self.api_put_vault()
            return self.send_json(405, {"error": "method not allowed"})
        if path == "/api/snapshots":
            if method == "GET" or method == "HEAD":
                return self.api_list_snapshots()
            if method == "POST":
                return self.api_post_snapshot()
            return self.send_json(405, {"error": "method not allowed"})
        if path.startswith("/api/snapshots/"):
            snap_id = self.split_snapshot_path(path)
            if method == "GET":
                return self.api_get_snapshot(snap_id)
            if method == "DELETE":
                return self.api_delete_snapshot(snap_id)
            return self.send_json(405, {"error": "method not allowed"})
        self.send_json(404, {"error": "not found"})

    # ---- static ----

    def serve_static(self, path):
        requested = unquote(path)
        if requested.startswith("/"):
            requested = requested[1:]
        if requested in ("", "index.html"):
            requested = "index.html"
        candidate = (ROOT / requested).resolve()
        if candidate != ROOT and not str(candidate).startswith(str(ROOT) + os.sep):
            self.send_json(403, {"error": "forbidden"})
            return
        if not candidate.is_file():
            self.send_json(404, {"error": "not found"})
            return
        if str(candidate).startswith(str(DB_PATH.parent)):
            self.send_json(403, {"error": "forbidden"})  # the database itself is not a web asset
            return
        mime = MIME.get(candidate.suffix.lower(), "application/octet-stream")
        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        if candidate.name in ("index.html", "sw.js", "manifest.webmanifest"):
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    server = ThreadingHTTPServer((HOST, PORT), PathstoneHandler)
    print(f"[vault] serving {ROOT} on http://{HOST}:{PORT} · database {DB_PATH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[vault] bye", flush=True)


if __name__ == "__main__":
    main()
