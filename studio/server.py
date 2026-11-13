"""Scol Console: a small local web app for turning textbooks into Scol lessons.

    studio/.venv/Scripts/python studio/server.py     # then open http://localhost:8765
"""
import json
import re
import shutil
import sys
import traceback
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import ai
import convert as cv

WEB = Path(__file__).resolve().parent / "web"
MAX_PDF = 200 * 1024 * 1024
ROUTES = []


def route(method, pattern):
    def deco(fn):
        ROUTES.append((method, re.compile(f"^/api{pattern}$"), fn))
        return fn
    return deco


def mask(p):
    k = p.get("api_key", "")
    return {**p, "api_key": ("•••" + k[-4:]) if k else ""}


@route("GET", "/overview")
def overview(q, body):
    projects = []
    for d in sorted(cv.PROJECTS.glob("*/project.json"), key=lambda f: -f.stat().st_mtime) if cv.PROJECTS.exists() else []:
        meta = json.loads(d.read_text(encoding="utf-8"))
        chs = cv.chapters(meta["id"])
        lessons = sum(len(c["lessons"]) for c in chs)
        approved = sum(1 for v in meta["review"].values() if v == "approved")
        projects.append({**meta, "chapters": len(chs), "lessons": lessons, "approved": approved})
    log = cv.DATA / "ai_log.jsonl"
    calls = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []
    by = {}
    for c in calls:  # tokens per provider and model
        b = by.setdefault(f"{c['provider']} · {c['model']}", {"name": f"{c['provider']} · {c['model']}", "calls": 0, "in": 0, "out": 0, "seconds": 0, "images": 0})
        b["calls"] += 1
        b["images"] += c.get("what") == "image"
        for k in ("in", "out", "seconds"):
            b[k] += c.get(k, 0)
    return {"projects": projects, "ai": {"calls": len(calls), "in": sum(c.get("in", 0) for c in calls),
                                         "out": sum(c.get("out", 0) for c in calls), "recent": calls[-8:][::-1],
                                         "by_provider": sorted(by.values(), key=lambda b: -b["calls"])},
            "jobs": cv.jobs()[:6],
            "push_target": str(cv.PUSH_ROOT.relative_to(cv.ROOT)), "providers": len(cv.providers())}


@route("GET", "/content-subjects")
def content_subjects(q, body):
    root = cv.ROOT / "content"
    return [str(s.parent.relative_to(root)).replace("\\", "/") for s in sorted(root.glob("*/*/*/subject.json"))
            if any((s.parent / c / "chapter.json").exists() for c in [x.name for x in s.parent.iterdir() if x.is_dir()])]


@route("GET", "/app-data")
def app_data(q, body):
    app = cv.ROOT / "content" / "_app"
    return {k: json.loads((app / f"{k}.json").read_text(encoding="utf-8")) for k in ("tutors", "phrases")}


@route("GET", "/providers")
def get_providers(q, body):
    return {"providers": [mask(p) for p in cv.providers()], "kinds": ai.DEFAULT_URL}


@route("POST", "/providers")
def put_providers(q, body):
    old = {p["id"]: p for p in cv.providers()}
    out = []
    for p in body:
        if not p.get("kind", "").strip() or not p.get("name") or not p.get("model"):
            raise ValueError("each provider needs a name, a kind and a model")
        if p.get("base_url") and not re.match(r"https?://", p["base_url"]):
            raise ValueError(f"{p['name']}: the base URL must start with http:// or https://")
        p["id"] = p.get("id") or cv.slug(p["name"])
        if not p.get("api_key") or p["api_key"].startswith("•••"):  # masked key came back: keep the stored one
            p["api_key"] = old.get(p["id"], {}).get("api_key", "")
        out.append({k: p.get(k, "").strip() for k in ("id", "name", "kind", "base_url", "model", "api_key", "use")})
    cv.save_providers(out)
    return get_providers(q, body)


@route("POST", "/providers/test")
def test_provider(q, body):
    text, usage = ai.ask(cv.provider(body["id"]), "You are a test.", "Reply with the single word OK.")
    return {"reply": text.strip()[:200], **usage}


@route("POST", "/projects")
def new_project(q, body):
    meta = {k: q.get(k, "") for k in ("title", "board", "class", "subject", "lang", "provider", "image_provider")}
    if not (meta["board"] and meta["class"].isdigit() and 1 <= int(meta["class"]) <= 12 and meta["subject"]):
        raise ValueError("board, class (1 to 12) and subject are needed")
    if meta["lang"] not in ("en", "ml", "both"):
        meta["lang"] = "both"
    src = q.get("from")
    if src:
        if not re.fullmatch(r"[a-z0-9-]+/class-\d+/[a-z0-9-]+", src) or not (cv.ROOT / "content" / src).is_dir():
            raise ValueError("unknown Scol subject")
        return cv.create(meta, from_content=src)
    if not body or body[:5] != b"%PDF-":
        raise ValueError("upload a PDF file")
    return cv.create(meta, pdf_bytes=body)


@route("GET", "/projects/([^/]+)")
def get_project(q, body, pid):
    meta = cv.load(pid)
    chs = cv.chapters(pid)
    for ch in chs:
        ch["lessons"] = [{"name": n, "status": meta["review"].get(f"{ch['id']}/{n}", "draft")} for n in ch["lessons"]]
    return {**meta, "chapter_list": chs, "has_pdf": (cv.pdir(pid) / "source.pdf").exists()}


@route("DELETE", "/projects/([^/]+)")
def del_project(q, body, pid):
    shutil.rmtree(cv.pdir(pid))
    return {"ok": True}


@route("POST", "/projects/([^/]+)/settings")
def project_settings(q, body, pid):
    meta = cv.load(pid)
    meta.update({k: body[k] for k in ("provider", "image_provider", "lang", "title") if k in body})
    cv.save(meta)
    return meta


@route("POST", "/projects/([^/]+)/jobs")
def new_job(q, body, pid):
    if not (cv.pdir(pid) / "pages.json").exists():
        raise ValueError("this textbook has no PDF")
    return cv.start_job(pid, body["kind"], body.get("chapters", []), body.get("note", ""))


@route("GET", "/jobs")
def list_jobs(q, body):
    return cv.jobs()


@route("DELETE", "/jobs/([^/]+)")
def del_job(q, body, jid):
    cv.delete_job(jid)
    return {"ok": True}


@route("POST", "/projects/([^/]+)/chapters")
def add_chapter(q, body, pid):
    d = cv.pdir(pid) / "chapters"
    n = len(cv.chapters(pid)) + 1
    cid = f"{n:02d}-{cv.slug(body['title'], 30)}"
    (d / cid).mkdir()
    cj = {"title": {"en": body["title"]}, "verified": False, "source": "", "objectives": [],
          "pages": [int(body.get("start", 1)), int(body.get("end", 1))]}
    (d / cid / "chapter.json").write_text(json.dumps(cj, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"id": cid}


@route("PUT", "/projects/([^/]+)/chapters/([^/]+)")
def save_chapter(q, body, pid, cid):
    if not isinstance(body.get("title"), dict) or not body["title"].get("en"):
        raise ValueError('chapter needs "title": {"en": ...}')
    (cv.chapter_dir(pid, cid) / "chapter.json").write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True}


@route("DELETE", "/projects/([^/]+)/chapters/([^/]+)")
def del_chapter(q, body, pid, cid):
    shutil.rmtree(cv.chapter_dir(pid, cid))
    return {"ok": True}


@route("GET", "/projects/([^/]+)/chapters/([^/]+)/images")
def list_images(q, body, pid, cid):
    d = cv.chapter_dir(pid, cid) / "images"
    return sorted(f.name for f in d.iterdir()) if d.is_dir() else []


@route("POST", "/projects/([^/]+)/chapters/([^/]+)/images")
def add_image(q, body, pid, cid):
    return {"name": cv.save_image(pid, cid, q.get("name", ""), body)}


@route("POST", "/projects/([^/]+)/chapters/([^/]+)/images/draw")
def draw_image(q, body, pid, cid):
    meta = cv.load(pid)
    if not meta.get("image_provider"):
        raise ValueError("pick a picture AI for this textbook first (top of the page)")
    cv.chapter_dir(pid, cid)
    return {"name": cv.draw_image(meta, cid, body["name"], body["scene"])}


@route("DELETE", "/projects/([^/]+)/chapters/([^/]+)/images/([^/]+)")
def del_image(q, body, pid, cid, name):
    f = cv.chapter_dir(pid, cid) / "images" / Path(name).name
    f.unlink()
    return {"ok": True}


def _lesson(pid, cid, name):
    meta, path = cv.load(pid), cv.lesson_path(pid, cid, name)
    lesson, problems = cv.check(path, cv.scope_of(meta))
    return {"name": name, "text": path.read_text(encoding="utf-8"), "lesson": lesson, "problems": problems,
            "status": meta["review"].get(f"{cid}/{name}", "draft")}


@route("GET", "/projects/([^/]+)/chapters/([^/]+)/lessons/([^/]+)")
def get_lesson(q, body, pid, cid, name):
    return _lesson(pid, cid, name)


@route("PUT", "/projects/([^/]+)/chapters/([^/]+)/lessons/([^/]+)")
def put_lesson(q, body, pid, cid, name):
    cv.lesson_path(pid, cid, name).write_text(body["text"].replace("\r\n", "\n"), encoding="utf-8")
    meta = cv.load(pid)
    if meta["review"].pop(f"{cid}/{name}", None):  # an edit needs a fresh approval
        cv.save(meta)
    return _lesson(pid, cid, name)


@route("DELETE", "/projects/([^/]+)/chapters/([^/]+)/lessons/([^/]+)")
def del_lesson(q, body, pid, cid, name):
    cv.lesson_path(pid, cid, name).unlink()
    meta = cv.load(pid)
    meta["review"].pop(f"{cid}/{name}", None)
    cv.save(meta)
    return {"ok": True}


@route("POST", "/projects/([^/]+)/chapters/([^/]+)/lessons/([^/]+)/improve")
def improve(q, body, pid, cid, name):
    cv.improve_lesson(pid, cid, name, body["note"])
    return _lesson(pid, cid, name)


@route("POST", "/projects/([^/]+)/chapters/([^/]+)/lessons/([^/]+)/review")
def review(q, body, pid, cid, name):
    got = _lesson(pid, cid, name)
    if body["status"] == "approved" and got["problems"]:
        raise ValueError("fix the problems before approving")
    meta = cv.load(pid)
    meta["review"][f"{cid}/{name}"] = body["status"]
    cv.save(meta)
    return {**got, "status": body["status"]}


@route("POST", "/projects/([^/]+)/push")
def push(q, body, pid):
    return cv.push(pid)


class Handler(SimpleHTTPRequestHandler):
    # HTTP/1.0 closes the socket right after each reply, which on Windows can cut replies over 64 KB short
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def log_message(self, fmt, *args):
        line = str(args[0]) if args else ""
        if "/api/" in line and "GET /api/jobs " not in line:  # the header polls jobs every few seconds
            sys.stderr.write("%s\n" % (fmt % args))

    def _api(self, method):
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_PDF:
            return self._send(413, {"error": "file is larger than 200 MB"})
        raw = self.rfile.read(n) if n else b""
        for m, rx, fn in ROUTES:
            hit = rx.match(urllib.parse.unquote(url.path))
            if m == method and hit:
                try:
                    binary = (self.headers.get("Content-Type") or "").split("/")[0] in ("application", "image", "video")                         and self.headers.get("Content-Type") != "application/json"
                    body = raw if binary else (json.loads(raw) if raw else {})
                    return self._send(200, fn(q, body, *hit.groups()))
                except (ValueError, KeyError, FileNotFoundError, FileExistsError, ai.AIError) as e:
                    return self._send(400, {"error": str(e)})
                except Exception as e:  # noqa: BLE001
                    traceback.print_exc()
                    return self._send(500, {"error": f"{type(e).__name__}: {e}"})
        return self._send(404, {"error": "no such API"})

    def _send(self, code, data):
        out = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        if self.path.startswith("/files/"):  # chapter pictures, at the same path the lesson JSON names them
            rel = urllib.parse.unquote(self.path[len("/files/"):].split("?")[0])
            f = (cv.ROOT / rel).resolve()
            if cv.PROJECTS.resolve() in f.parents and f.parent.name == "images" and f.is_file():
                return self._file(f)
            return self._send(404, {"error": "no such file"})
        if self.path.split("?")[0] == "/logo.png":
            return self._file(cv.ROOT / "app" / "branding" / "logo.png")
        return super().do_GET()

    def _file(self, f):
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(f)))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        return self._api("POST")

    def do_PUT(self):
        return self._api("PUT")

    def do_DELETE(self):
        return self._api("DELETE")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    cv.PROJECTS.mkdir(parents=True, exist_ok=True)
    cv.mark_interrupted()
    # localhost only: provider keys live in studio/data and the API has no login
    print(f"Scol Console on http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
