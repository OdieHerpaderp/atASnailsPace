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
| `maps.js` | the bit both preview pages share: load `meshes/tex/` and hand a model the maps its own file declares, the way the game does |
| `plan-test.mjs` | the track planner imported and run in node, for checking a course or an obstacle |
| `check.sh` | the static gate: every module parses, and `wired.mjs` reads the whole graph |
| `wired.mjs` | the graph itself, in four directions - see *Reading the graph* |
| `e2e/` | the browser suite: 25 Playwright tests against a golden baseline captured from the pre-split game |
| `playwright.config.js` | the runner: SwiftShader, a 480×300 window, and the bottom preset pinned at render scale 1× |
| `backup/` | models as they were before they were changed, kept in case a model has to be compared with what it was |

## The routes the server adds

| | |
|---|---|
| `/_harness/snail.html` | `meshes/build-snail.html` with an export hook in it |
| `/_harness/shell.html` | `meshes/build-shell.html` likewise |
| `/_harness/scenery.html` | `meshes/build-scenery.html` likewise |
| `/_harness/textures.html` | `meshes/build-textures.html` likewise, posting into `meshes/tex/` |
| `/tools/render.html?f=hut.glb` | a model on its own |
| `/tools/compare.html?a=meshes/hut.glb&b=meshes/mushroom-giant.glb` | two models, side by side and overlaid |
| `/tools/inspect.html?f=snail.glb` | the inside of a model file |
| `POST /__save?name=x.glb` | writes into `meshes/` |
| `POST /__save?name=x.png&dir=tex` | and into `meshes/tex/` |

The harness routes are the whole point of the server. Each builder page is a
page of three.js that writes a `.glb` or a `.png` when you press its button; the
hook served in its place gives the page a function that builds it and posts the
bytes straight into `meshes/`. So a change is: edit the builder, open the harness,
press the button, reload the game. Nothing is written by hand and no scratch file
lands in the project.

    window.__snailExport('snail.glb')
    window.__shellExport('swirl', 'shell-swirl.glb')
    window.__sceneryExport('lantern-arch')          // appends .glb
    window.__texExport('rock-n')                    // appends .png, into tex/

Each returns `{ bytes, ok }`, and `ok: false` means the server was not reached
rather than that the build failed. `dir` is a key into an allowlist of `""` and
`"tex"`, not a path — the server has no authentication, so nothing in it accepts
one.

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
