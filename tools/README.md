# tools

The kit for working on the meshes in `meshes/` and the maps in `meshes/tex/`.
Nothing in here is part of the game: the game is `snail-race.html`,
`src/*.js`, `races.json` and `seasons.json`, and it never reads any of this.

    python3 tools/serve.py          # http://127.0.0.1:8713

## What each one is for

| | |
|---|---|
| `serve.py` | the game, plus a dev server with no cache on it and a few routes for building models and maps without leaving the browser |
| `render.html` | one model on its own, four angles or one, wearing the maps its file declares |
| `compare.html` | two models at once: A, then B in the same framing, then B over a ghost of A, with the numbers that answer "is it the right size" |
| `inspect.html` | what is actually inside a `.glb`: mesh names, vertex counts, bounding boxes, attributes, maps — and the audit of the whole map manifest at the foot |
| `wardrobe.html` | the ten faces and the seven hats on the game's **own head** out of `meshes/snail.glb` — every one of them, or one face against every hat, or one pair, big |
| `maps.js` | the bit both preview pages share: load `meshes/tex/` and hand a model the maps its own file declares, the way the game does |
| `plan-test.mjs` | the track planner imported and run in node, for checking a course or an obstacle |
| `bench.mjs` | frame rates for a cup's courses, raced on the card the machine has - see *Reading a frame rate* |
| `check.sh` | the static gate: every module parses, and `wired.mjs` reads the whole graph |
| `wired.mjs` | the graph itself, in four directions - see *Reading the graph* |
| `e2e/` | the browser suite: 26 Playwright tests against a golden baseline captured from the pre-split game, and the one capture both of its specs share |
| `playwright.config.js` | the runner: SwiftShader, a 480×300 window, the bottom preset pinned at render scale 1×, and no server reuse |
| `backup/` | models as they were before they were changed, kept in case a model has to be compared with what it was |

## The routes the server adds

| | |
|---|---|
| `/_harness/snail.html` | `meshes/build-snail.html` with an export hook in it |
| `/_harness/shell.html` | `meshes/build-shell.html` likewise |
| `/_harness/scenery.html` | `meshes/build-scenery.html` likewise |
| `/_harness/textures.html` | `meshes/build-textures.html` likewise, posting into `meshes/tex/` |
| `/_harness/face.html` | `meshes/build-face.html` likewise, posting into `meshes/faces/` |
| `/_harness/hat.html` | `meshes/build-hat.html` likewise, posting into `meshes/hats/` |
| `/tools/render.html?f=hut.glb` | a model on its own |
| `/tools/compare.html?a=meshes/hut.glb&b=meshes/mushroom-giant.glb` | two models, side by side and overlaid |
| `/tools/inspect.html?f=snail.glb` | the inside of a model file |
| `/tools/wardrobe.html?face=cheer&hat=straw` | one face and one hat, on one head |
| `POST /__save?name=x.glb` | writes into `meshes/` |
| `POST /__save?name=x.png&dir=tex` | and into `meshes/tex/`, `dir=faces` and `dir=hats` |

The harness routes are the whole point of the server. Each builder page is a
page of three.js that writes a `.glb` or a `.png` when you press its button; the
hook served in its place gives the page a function that builds it and posts the
bytes straight into `meshes/`. So a change is: edit the builder, open the harness,
press the button, reload the game. Nothing is written by hand and no scratch file
lands in the project.

    window.__snailExport('snail.glb')
    window.__shellExport('shell', 'shell.glb')
    window.__sceneryExport('lantern-arch')          // appends .glb
    window.__texExport('rock-n')                    // appends .png, into tex/
    window.__faceExport('cheer')                    // appends .glb, into faces/
    window.__hatExport('straw')                     // appends .glb, into hats/

Each returns `{ bytes, ok }`, and `ok: false` means the server was not reached
rather than that the build failed. `dir` is a key into an allowlist of `""`,
`"tex"`, `"faces"` and `"hats"`, not a path — the server has no authentication, so
nothing in it accepts one. **The wardrobe's two are the reason the allowlist is a
list**: the name carries no folder, because `do_POST()` takes `basename()` of it,
and a face posted as `faces/cheer.glb` lands at `meshes/cheer.glb` in silence.

## Turning a model round

Both the single-model page and the comparison page take the mouse:

| | |
|---|---|
| drag | turn it round — and on a multi-view page every view turns together |
| shift-drag (or middle-drag) | slide the view across the model without turning it |
| wheel | come closer or further |
| double-click | put the view back where the page set it |

It is there because a preview that can only be seen from the three-quarter it
was set up on is good for a first look and useless for the second: a shape can
look right from the front and be wrong from the side, a seam can hide behind the
piece, and something standing at the wrong angle to the ground only shows once
you can get down to it.

## Reading the render page

    /tools/render.html?f=snail.glb                    four angles
    /tools/render.html?f=hut.glb&v=shell              the angles that suit a prop
    /tools/render.html?f=snail.glb&view=1&a=1.9       one angle: a is the bearing
    /tools/render.html?f=snail.glb&view=1&d=0.4&t=0.2 closer, aimed at a point
    /tools/render.html?f=snail.glb&body=0xf3e7d3&shell=0xb0662f
    /tools/render.html?f=rock.glb&maps=0              the same model with no maps

`a` is where the camera stands, in radians. `0` is in front of the model looking
back down it, `1.57` is a side view, `3.14` is behind it. The model is lifted by
the same `0.088` the game stands it on, so a sole that touches the ground here
touches it there.

The framing is worked out from the model itself, the same rule `compare.html`
uses, so a house and a snail are both shown whole without anything being set by
hand. `&d=` and `&camy=` override it, and `&t=` aims at a point on the model.

The model wears the maps out of `meshes/tex/`, attached by name from the same
manifest the game reads — a glb carries no images, so a page that did not do
that itself would be showing a prop with its surface missing and reaching a
conclusion about a normal map it never loaded. `&maps=0` takes them off again,
which is how you see a prop as it looked before its phase. Only a file in
`meshes/` gets them: the copy of one in `backup/` is a record of what it used to
be, and a comparison wants the old one to look old.

## Reading the wardrobe

    /tools/wardrobe.html                        every face and every hat, bare heads
    /tools/wardrobe.html?face=cheer             that face on every hat
    /tools/wardrobe.html?hat=straw              that hat on every face
    /tools/wardrobe.html?face=cheer&hat=straw   one pair, big
    &on=snail                                   the whole snail rather than the head
    &cols=6                                     how many a row (default 5)
    &body=0xf3e7d3&shell=0xb0662f               the snail's own colours
    &turn=0                                     hold still

A face is four centimetres of geometry placed against six numbers, so this page
wears **`meshes/snail.glb`'s own `headG` node** and drops the piece on it at the
origin — the same two lines `makeSnail()` runs. It does not build a head of its
own: a preview page carrying its own copy of the head's numbers is a second place
for them to be wrong, and both builder pages already have the numbers written down
beside the code that places a hat on them. This one cannot disagree with the game.

**The second view is the one worth having.** A grid of every face on its own head
is the first thing anybody wants; *one face against every hat* is the question
nobody thinks to ask and the one that finds a brim that hides a brow. It already
has: the feelers come through the crown of every hat in the set.

**And it says a name with no file behind it.** `--faces` checks that the manifest
and the derivation agree; this page checks that the bytes are there and that the
part naming is one the loader will accept. The failure the two halves share is
silent in the game — a rival wearing a name no file is behind draws as a snail
with no face, which is indistinguishable from a snail whose face is plain — so it
is worth saying twice in two different places.

`window.__wardrobe` is the same kind of handle as `window.__snail`: `cells`,
`files`, `frame` and `draw()`, for asking a page what it found rather than only
looking at it.

## Reading the planner

    node tools/plan-test.mjs                    every course, two seeds
    node tools/plan-test.mjs sky 11 777         one course, these seeds
    node tools/plan-test.mjs sky 11 --leaps     and the gaps, with their sizes

**It imports `src/plan.js` and runs it**, which is the whole of why the planner
has no three.js in it: `src/core.js` is importable in Node, so this prints what
the game would build rather than what a copy of the game's source says it would
build. It used to do the other thing — read the file as text, regex for a
declaration, guess at the rest — and it guessed wrong about a course's `scale`,
so every length it printed was the unscaled one. A number a tool reads out of
another file's source is a second implementation of that file.

The condition line is the course in order — `RUN×20 CLIMB×8
FLY×9 CLIMB×10` is a run, a lip, a gap to fly and the wall on the far side of
it — and `--leaps` gives every gap's width, how far the lip stands above the
lane, and how deep the water is.

## Reading a frame rate

    node tools/bench.mjs                              the first cup, High, 1280×720
    node tools/bench.mjs --w 2560 --h 1440            the panel's own pixels
    node tools/bench.mjs --cup gp --preset Ultra      another cup, another rung
    node tools/bench.mjs --courses dash,splash        two of them
    node tools/bench.mjs --secs 20                    a fixed window, not a race

It races each of a cup's courses - read out of `seasons.json`, finale included -
and writes `bench/<cup>-p<preset>-<w>x<h>-<when>.json` and a `.md` beside it
carrying the same numbers as a table. **A frame rate is a fact about a machine and
not about the build**, which is why the card, the window, the render scale, the
preset, the display's refresh and the passes the frame went through are in the file
beside the numbers: the same course on another card, at another resolution or one
preset up is a different number, and a table that does not say which is an
anecdote.

**It is not `tools/e2e/`, and the difference is the whole of what it is.** The
suite runs SwiftShader at 480×300 because it asserts numbers rather than pictures
and a software rasteriser holds a county of 144 thousand pixels sixty times a
second. **So this asks for the real renderer and exits rather than print a table
if it cannot get one** - a headful chromium on a machine with no card falls back
to SwiftShader silently, and a frame rate off one is not wrong-looking: it is
honest arithmetic over 3.7 megapixels at about a fortieth of the speed, which is
indistinguishable from a slow card once it is in a table. `--allow-software`
overrides it, and `--arg=--use-angle=swiftshader` is how the refusal is tested on a
machine that has a card.

**The window opens when the countdown ends and closes when the race finishes**,
after the probe queue has drained and after a settle: a cube probe is six scene
renders and a PMREM, one is pumped every 260 ms, and a window that opens with
three queued is measuring the county catching up with itself. The frame time is
the raw gap between rAF callbacks - a second `requestAnimationFrame` in the same
page, which is handed the same timestamp as the game's, so the gap it records is
the gap `src/app.js` pushes into `perfPush()` and not the loop's clamped `dt`.

**And it is vsync-quantised, which is the shape of every number in the table.** A
frame is either one refresh interval or the next one up, so the medians are 8.3 or
16.7 and nothing between, and an average is a blend of two rates rather than a
rate. `missed` is the honest column: **a frame is missed when it lands on the next
vsync deadline, not when it is slow**, so it counts the frames that took the longer
step, and a course marked *at the refresh* is being paced by the display and says
nothing about what the card could do.

**The scene's own numbers are medians over the window and not the last frame's**,
because `renderer.info` is reset once per frame and read again after it, so one
reading is whatever the camera happened to be looking at when the race ended -
Hedgerow Dash measured 27.9 M triangles at the finish line and 27.1 M six seconds
in, on the same preset at the same resolution. And `tris/frame` is the **whole**
frame: the occlusion and indirect-light passes each rasterise the scene again.

**And every course is also split along the lane**, on by default and quietened with
`--quiet`, because a total cannot tell **a course that is slow everywhere** from
**a course that is slow in one place**, and the second is the one anybody can act
on. Each frame is tagged with the racer's own arc position and the window is cut
into the bower's own ranges where the plan dealt a bower - `bowerReport().s` is the
arc, so "is it the tunnel" is a question with metres attached - and ten arcs of the
lane where it did not.

**Sort a section by `mean ms` and not by `med ms`.** The median is either one
refresh interval or the next one up, so on a course already missing most of its
deadlines it saturates: Hedgerow Dash's is **16.7 ms on the open road and 16.7 ms
under the bower**, while the means are **14.0 and 16.8** - and watching the frame
rate from the outside is what turned that into ~70 fps on the road and ~60 in the
tunnel, which the whole-race total could not show. **A median that has hit the
refresh has no resolution left and the mean is what is still measuring.**

Run to run the whole-race figure moves about ±2 fps and a section figure about ±1,
so a difference smaller than that is not a difference. `.kilo/skills/perf-bench/`
is the working document: the questions worth asking of a slow course, what an
observation has to carry, and what this cannot tell you.

**There is deliberately no way to ask for an uncapped ceiling.** It is the obvious
next flag and it does not work: with `--disable-gpu-vsync
--disable-frame-rate-limit` the refresh is out of the loop and rAF is no longer
paced by a display answering every frame - Hedgerow Dash came back with a **204 ms
worst frame and a 1% low of 18 fps** on a course the vsync run put at a 16.7 ms
median, and the browser closed on the fifth course. So the ceiling is asked the
only way that answers honestly: **raise the work** - a bigger window, a higher
preset - and read the frame time once the median has left the refresh interval.

The results are gitignored. `tools/e2e/baseline.json` is committed because
SwiftShader at 480×300 is the same rasteriser on every machine that runs it, so it
is comparable; a bench run on one card at one resolution is not comparable to
anything, and committing one would invite the reading that it is a floor or a
ceiling.

## Reading the graph

    tools/check.sh                              all eleven modules, and the graph
    tools/check.sh src/surfaces.js              one file, parsed
    node tools/wired.mjs src/*.js meshes/palette.js meshes/maps.js

`check.sh` parses every file in `src/` under an `.mjs` name — `node --check`
reads the extension to decide whether a file is a module or a script, so a `.js`
with a bare `import` at the top is a syntax error to it — and then runs
`wired.mjs`, which reads the whole graph in four directions: a name a file
imports that another module does not export, a name a file reads bare that
another module declares and it did not import, a field of `world` read by nobody
who writes it, and a top-level read of a `const` declared below it.

**The third one is the direction the split cannot see for itself.** A registry
field nobody fills has a default, and a plausible empty default reads as a quiet
answer rather than as a missing one: four of them sat unfilled through four steps
with the whole browser suite green, and the things they broke were the shadows
row, the reflection probes on every course, and the rebuild a density row asks
for — none of which any committed artifact measures. The fourth is the temporal
dead zone, which is a crash on a module's first line and which is only a crash
until something moves the two lines apart.

**Both the gate and the suite read the tree they are checking, off their own
location.** `wired.mjs` resolved a hardcoded `/home/odie/…` once, which made it
validate *that* checkout from wherever it was run — a clone with a genuinely
broken import came back `11 modules` and exited zero. And the suite used to reuse
whatever held 8713, which is the same failure one layer out: a checkout that could
not boot reported twenty-six passes against a server somebody else had left
running. `run.sh` now asks the OS for a free port and nothing is reused, so a
port in use is an error naming the port.

## Reading the server

    python3 tools/serve.py        # http://127.0.0.1:8713
    PORT=9000 python3 tools/serve.py

The dev server is loopback-only and serves the tree plus a few builder routes. Two
things it deliberately refuses: a request target that is not origin-form or whose
real path leaves the root (`normpath` keeps a leading `..`, and `lstrip("/")` only
strips the slash, so a relative target walked out and served `/etc/passwd`), and a
`POST /__save` for anything that is not a `.glb` or a `.png` — that route confined
the *folder* and not the file, so `?name=palette.js` replaced a tracked source file
with whatever the body was. It writes through a `.part` and `os.replace`s, so a
short body leaves the old file rather than a truncated one.

## Reading the comparison

    /tools/compare.html?a=meshes/snail.glb&b=tools/backup/snail.glb
    /tools/compare.html?a=meshes/hut.glb&b=meshes/lantern-arch.glb&flat=1
    /tools/compare.html?a=tools/backup/rock.glb&b=meshes/rock.glb
    &scaleB=1.4    scale B before looking at it
    &flat=1        both in one neutral material: compares shape, not colour
    &maps=0        no maps on either
    &boxes=0       no bounding boxes
    &views=1|2|3   how many of the three views

A path is a path in this project, so a model can be compared with the copy of it
in `backup/` — which is the point: a model that has been changed has no
before in the folder, and the only way to see what the change was is to keep one.
Comparing the backup of a converted prop against the converted one is how you
answer "did the geometry change, or only the surface", and the `B ÷ A` row says
which: all ones means only the surface moved.

The three views are deliberate. A and B are drawn **in the same framing**, so a
size read off one is the same size on the other; the third draws B over a ghost
of A, so a change of shape reads as one standing off the outline of the other.
The table gives each one's size, how many meshes and vertices it is made of, which
map slots it has filled, and the ratio of B to A per axis, with anything over 1 in
green and under in amber.

**scale B to match A** sets B's scale so its biggest side is A's biggest side,
which is the fastest way to answer "how big should this be" — and the *ratio
table* after it is then the shape difference, with the size taken out of it.

`&flat=1` matters more than it looks: two models in their own colours can look
the same size when they are not, because one is pale and one is dark.

Nothing in the game is scaled into place except the racers, so the units a model
is built in are the units it appears in: one unit is about a snail's length, the
lane is 5.6 across, and the stand a racer is drawn on lifts it 0.088.
