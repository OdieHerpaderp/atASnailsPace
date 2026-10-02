#!/usr/bin/env python3
"""Dev server for working on the meshes in meshes/.

The game is served as it is - open snail-race.html and play - plus a few
routes that exist to make a model change a loop instead of a chore:

  /                        the project, so the game runs normally
  /_harness/snail.html     meshes/build-snail.html with an export hook in it,
  /_harness/shell.html     .../build-shell.html ...
  /_harness/scenery.html   .../build-scenery.html ...
  /_harness/textures.html  .../build-textures.html ...
                           Each hook gives the page a window.__snailExport /
                           __shellExport / __sceneryExport / __texExport, which
                           builds the model or the map in the browser and POSTs
                           the bytes straight into meshes/. Nothing is written
                           into meshes/ by hand and no scratch file lands in
                           the project.
  /tools/render.html       a model on its own, four angles or one
  /tools/inspect.html      what is actually inside a .glb: mesh names, vertex
                           counts, bounding boxes, maps
  POST /__save?name=x.glb  writes into meshes/
  POST /__save?name=a.png&dir=tex   ... and into meshes/tex/, for the maps

Nothing is cached, because a stale build of the thing being worked on is worse
than no build at all.

    python3 tools/serve.py            # http://127.0.0.1:8713
    PORT=9000 python3 tools/serve.py
"""
import http.server
import os
import socketserver
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# **And the same place with symlinks resolved**, which is what the containment
# check below compares against: `realpath` of a target inside the root can still
# land outside it through a link, and comparing an unresolved root against a
# resolved target is a comparison between two different questions. It is also the
# only correct answer when the repository itself is reached through a symlink -
# a link into it is a legitimate way to ask for the game and a link out of it is
# not, and only the resolved form tells the two apart.
ROOT_REAL = os.path.realpath(ROOT)
PORT = int(os.environ.get("PORT", "8713"))

# what each builder's page exposes for the harness to drive
HOOKS = {
    "snail": """
window.__snailExport = async (name) => {
  const root = built || (built = await assemble());
  const buf = await new Promise((res, rej) =>
    new GLTFExporter().parse(root, res, rej, { binary: true, onlyVisible: false }));
  const r = await fetch('/__save?name=' + (name || 'snail.glb'),
    { method: 'POST', body: buf });
  return { bytes: buf.byteLength, ok: r.ok };
};
""",
    "shell": """
window.__shellExport = async (style, name) => {
  const root = await assemble(style);
  const buf = await new Promise((res, rej) =>
    new GLTFExporter().parse(root, res, rej, { binary: true, onlyVisible: false }));
  const r = await fetch('/__save?name=' + name, { method: 'POST', body: buf });
  return { bytes: buf.byteLength, ok: r.ok, name };
};
""",
    "scenery": """
window.__sceneryExport = async (name) => {
  const root = assemble(name);
  const buf = await new Promise((res, rej) =>
    new GLTFExporter().parse(root, res, rej, { binary: true, onlyVisible: false }));
  const r = await fetch('/__save?name=' + name + '.glb', { method: 'POST', body: buf });
  return { bytes: buf.byteLength, ok: r.ok, name };
};
""",
    "textures": """
window.__texExport = async (name, dir) => {
  // buildMap is the page's: it takes a name from its MAPS table and gives back
  // a canvas, so this hook only has to turn that canvas into bytes and post it
  const canvas = buildMap(name);
  if (!canvas) return { ok: false, name, error: 'no map called ' + name };
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const buf = await blob.arrayBuffer();
  const r = await fetch('/__save?dir=' + (dir || 'tex') + '&name=' + name + '.png',
    { method: 'POST', body: buf });
  return { bytes: buf.byteLength, ok: r.ok, name, dir: dir || 'tex' };
};
""",
}

# The one place the dev server writes to, and the only subfolder of it that
# anything may write into. A path is not accepted: `dir` is a key into this,
# not path, so there is nothing to traverse out of. `tex` holds the maps that
# meshes/build-textures.html draws; everything else lands beside the glbs.
SAVE_DIRS = {"", "tex"}

# **And the only two things it will write**, which is the other half of the
# same guard. `SAVE_DIRS` confines the *folder* and this confines the file, and
# between them a POST cannot touch a tracked source file: without it,
# `POST /__save?name=palette.js` replaced `meshes/palette.js` with five bytes
# and the server served the clobbered content straight back. The route exists for
# the builders' export hooks, and those write glbs and pngs and nothing else -
# so an extension outside this set is a request this server has no reason to
# believe in.
SAVE_EXTS = {".glb", ".png"}

CTYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript",
    ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
}


def harness(name):
    """A builder's page with the export hook pushed into its module scope."""
    src = open(os.path.join(ROOT, "meshes", "build-%s.html" % name)).read()
    i = src.rindex("</script>")
    return (src[:i] + HOOKS[name] + src[i:]).encode()


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, body, ctype, code=200, head_only=False):
        self.send_response(code)
        if ctype:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def do_HEAD(self):
        # so a page can ask "is this file there" without downloading it: the
        # texture page asks about fifteen of them on every load.
        #
        # And it has to **answer the question**, or asking it is pointless. A HEAD
        # that replies 200 to a file that is not there makes "on disk" true for
        # every map the manifest names, and then the page's whole reason for
        # existing - a name declared with no file beside it - can never be seen,
        # and "write the ones with no file" writes nothing and says so
        # cheerfully. The body is passed so the length is the real one; head_only
        # is what stops it being written.
        found = self._find()
        if not found:
            return self.send_error(404)
        ctype, body = found
        self._send(body, ctype, head_only=True)

    def _find(self):
        """The file a GET or a HEAD is about, and its content type, or None."""
        path = urllib.parse.urlparse(self.path).path
        # A builder served from /_harness/ asks for its own folder by name, and
        # so do the modules the builders import - which is why only a page is a
        # builder and everything else under /_harness/ falls through to the
        # ordinary static routes below and their meshes/ fallback.
        if path.startswith("/_harness/") and path.endswith(".html"):
            which = os.path.basename(path)[:-len(".html")]
            if which not in HOOKS:
                return None
            return ("html", harness(which))
        if path in ("/", "/snail-race.html"):
            path = "/snail-race.html"
        # **Containment, checked rather than assumed.** `normpath` collapses
        # `a/../b` but keeps a *leading* `..`, and `lstrip("/")` only strips the
        # slash - so a request target that does not begin with one (which a browser
        # never sends, and `urllib` and `curl --path-as-is` both will) walked
        # straight out of the repository and served `/etc/passwd`. The dev server
        # is loopback only, so this is containment rather than a privilege
        # boundary, but it was accidental: the `SAVE_DIRS` check on the write route
        # is deliberate and this was `normpath` doing the work by luck. Both ends
        # of it now - reject a target that is not origin-form, and refuse anything
        # whose real path has left the root, which also catches a symlink and which
        # the first check cannot see.
        if not path.startswith("/"):
            return None
        rel = os.path.normpath(path).lstrip("/")
        target = os.path.join(ROOT, rel)
        if os.path.commonpath([ROOT_REAL, os.path.realpath(target)]) != ROOT_REAL:
            return None
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        # a builder served from /_harness/ asks for its own folder by name, and
        # so do the maps in its tex/ subfolder: the path it asks for is the one
        # it would ask for sitting in meshes/, so strip the harness prefix and
        # look in meshes/ instead of in the project root
        if not os.path.isfile(target):
            sibling = os.path.join(ROOT, "meshes", rel.replace("_harness/", "", 1))
            if os.path.isfile(sibling):
                target = sibling
        if not os.path.isfile(target):
            return None
        with open(target, "rb") as f:
            return (CTYPES.get(os.path.splitext(target)[1], "application/octet-stream"), f.read())

    def do_GET(self):
        found = self._find()
        if not found:
            return self.send_error(404)
        ctype, body = found
        self._send(body, ctype)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/__save":
            return self.send_error(404)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = os.path.basename(q.get("name", ["snail.glb"])[0])
        d = q.get("dir", [""])[0]
        if d not in SAVE_DIRS:
            return self.send_error(400, "dir must be one of %s" % sorted(SAVE_DIRS))
        # `basename` above took the traversal out of the *path*; this takes it out
        # of the *extension*, because the path was never the way in. A name that
        # is not a glb or a png is not something a builder hook asks for.
        if os.path.splitext(name)[1].lower() not in SAVE_EXTS:
            return self.send_error(
                400, "name must end in one of %s" % sorted(SAVE_EXTS))
        folder = os.path.join(ROOT, "meshes", d)
        if not os.path.isdir(folder):
            os.makedirs(folder, exist_ok=True)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        target = os.path.join(folder, name)
        # **Write to a temporary name and move it into place, rather than opening
        # the real one for writing.** A truncated overwrite is a lost file: if the
        # body is short or the request dies half way, the old content is already
        # gone and the new content is not there yet. `os.replace` is atomic within
        # a filesystem, so the file is either the old one or the new one.
        tmp = target + ".part"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, target)
        self._send(b"ok", "text/plain")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as srv:
        print("serving %s on http://127.0.0.1:%d" % (ROOT, PORT))
        srv.serve_forever()
