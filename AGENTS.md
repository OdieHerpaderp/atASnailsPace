# Snail Grand Prix

A racing game. Five courses, a season ladder, and eight snails. The whole thing
is a spline-cut lane with rock walls to climb, ponds to swim and gaps to fly;
every snail carries five traits and the course decides which one is working. No
build step, no package manager, no dependencies to install. **The game is eleven
modules under `src/`**, loaded by `src/app.js` as ordinary ES modules over the
import map in `snail-race.html`, and the eleven are listed below.

    python3 tools/serve.py        # http://127.0.0.1:8713

That is the only way to run it. Opening `snail-race.html` off the filesystem
fails: the game fetches `races.json`, `seasons.json`, `meshes/*.glb` and
`meshes/tex/*.png`, so it has to be served. `tools/serve.py` is the dev server
and it is deliberately the game plus a few mesh-building routes (see *Models*
below). Port via `PORT=9000`.

## What is what

| | |
|---|---|
| `snail-race.html` / `.css` | the shell: every screen and id, nothing else |
| `src/*.js` | the whole game in eleven modules, no bundler - see the table below |
| `races.json` | the five courses, and the obstacles each is built out of |
| `seasons.json` | the four tiers, the rating band each covers, its length scale |
| `meshes/*.glb` | the prop library, one file per prop, drawn instanced |
| `meshes/faces/*.glb` | the ten faces, one file each, swapped onto a snail's head |
| `meshes/hats/*.glb` | the seven hats, one file each, and the propeller's rotor beside them |
| `meshes/tex/*.png` | the maps the props wear, one folder, loaded by name |
| `meshes/maps.js` | **the map manifest** - which piece declares which map, and why |
| `meshes/palette.js` | **the colour jar** - every colour in the project, linear |
| `meshes/biomes.js` | **the biome table** - what a course looks like, and nothing else |
| `meshes/build-*.html` | pages of three.js that generate some of those files |
| `tools/` | the server, the static gates, the browser tests, and the model pages |

### The eleven modules

The graph is a chain and a fan, and **the one rule it obeys is that `world` is the
only thing that goes sideways**. Every edge below is an import; the sideways lines
are not, and they are `src/graphics.js`'s registry.

| | lines | what it is |
|---|---|---|
| `src/core.js` | 742 | data, tuning, seasons, the wardrobe tables, noise, geometry helpers, and the one three.js import |
| `src/plan.js` | 831 | the pure planner: no three, so Node can import it and `tools/plan-test.mjs` can ask it |
| `src/graphics.js` | 1,080 | the settings ladder, the renderer, the dome, and **`world`** |
| `src/materials.js` | 1,436 | the glb loader, the material jar, the palette adapter, the shader injectors |
| `src/course.js` | 716 | the track samples, the frame, and `groundYAt()` |
| `src/surfaces.js` | 1,463 | the four surfaces, the water, and the half-way |
| `src/scenery.js` | 1,717 | the tower, the lamps, `scatter()`, the farms, the backdrop |
| `src/post.js` | 1,789 | the settings panel, the chain, the probes, the readback |
| `src/race.js` | 1,896 | the snail, the field, the sim, the crates, The Adversary, the save |
| `src/stage.js` | 705 | the stable and its rebuild |
| `src/app.js` | 2,559 | the camera, the frame loop, the perf panel, every screen, the boot |

**The imports, and they are the whole dependency story:**

    core  <-  everything
    plan  <-  core
    course  <-  core, graphics, plan
    graphics  <-  core
    materials  <-  core, graphics
    surfaces  <-  core, graphics, course, materials
    scenery  <-  core, graphics, materials, course, surfaces
    post  <-  core, graphics, materials
    race  <-  core, graphics, materials, post, course, surfaces, scenery
    stage  <-  core, graphics, materials, post, scenery, race
    app  <-  all ten

**No cycles, and three of the edges are there for one name each** - `app.js` needs
`updateWater()` from itself and nothing, `stage.js` needs the snail from `race.js`,
and `race.js` needs the water's shared uniform from `post.js`. Everything else that
*looks* like an edge going backwards goes through `world`: eight functions in the
graphics stack read a scene, a mode, a clock or a camera that belong to `app.js`,
and they read `world.scene`, `world.modeOf()`, `world.clock()` and `world.camera`
instead.

**The registry has twenty-three members and fifteen of them are functions**, because
a field written once is a field that is wrong on the next frame. Eight carry a
scene, a stage, an env or a camera; **every one of the other fifteen is a function
because it reads something reassigned after boot** - `mode` and `clock` on every
start, `surging` on every key event, and the ten that are somebody else's screen
(`syncHUD`, `updateHUD`, `flashGo`, `showResults`, `applyLook`, `forceTimeOfDay`,
`restage`). **Four of them being written by nobody is the one failure the graph
cannot see for itself**, which is what `tools/wired.mjs`'s third direction is for
and what the registry test in `tools/e2e/` pins.

three.js 0.170 is imported from a CDN and nowhere else, as a **top-level `await`
dynamic import of a literal URL** in `src/core.js`; `snail-race.html` carries the
import map. Do not add a dependency, and do not pin a different three version in
one place only. The map carries two specifiers, `three` and `three/addons/`, and
**neither of them is the game's**: `three` is used by `tools/*.html` and
`meshes/build-*.html`, and the addons are the post-processing passes, fetched on
demand by `loadAddons()` the first time a tier asks for one and never again (see
*Settings*). `meshes/palette.js` and `meshes/maps.js` are plain modules with no
three import, so they are read by the game and by all four builder pages.

**And `src/core.js` has to be importable by Node**, which is the one constraint the
browser does not impose: `plan.js` and `tools/plan-test.mjs` import it, and there is
no `window` in a terminal. So the three.js import is behind an environment test and
`races.json` and `seasons.json` are read from disk on that side and fetched on this
one. **It is the only module in the county that knows which of the two it is in**, and
that is the price of a planner that can be asked a question without a browser.

**Shading is smooth.** Nothing in the world is flat shaded any more, so a face
reads as a face because the geometry says so and not because the shader is
averaging away the corner - which means the geometry has to hold up on its own.
The one exception is the backdrop, which keeps its flat shading on purpose: a
hill is a nine-by-six sphere, and smooth-shaded there is a black shape against a
bright sky at a low sun, because no facet is left facing it.

## The rules that bite

**A module's live bindings are read-only from outside, and that is a runtime
error rather than a lint.** An exported `let` cannot be assigned from another
file — `TypeError: Assignment to constant variable`, on the first call and with
nothing in the console to explain it — and it cannot be emptied, which is the
worse half, because `simSurge = false` reads as ordinary code and throws for
everybody who draws it. So every flag a module shares comes out as a pair:
`clearRegister()` and `standingReport()` for the prop register, `takeGrab()` for
the pending frame read-back, `forgetCastApplied()` for the shadows row's
one-shot, `stageOf()` and `buildStable()` for the stable, `world.racers()` for
the field. **The tell is a call site that looks like an assignment and is not**,
and `tools/wired.mjs` cannot see it, because an assignment to an imported name
parses.

**A registry field nobody fills is a quiet answer, and quiet is the dangerous
kind.** `world` is a set of defaults that modules fill at module scope, so a
field left alone has a plausible empty value — `() => []`, `() => {}`, `null` —
and the code that reads it goes on running. Four sat unfilled through four steps
of the split with the whole browser suite green: the shadows row stopped
stamping props, no course got a reflection probe, and a density change never
rebuilt the stable. **A default is an answer, and an empty one is the answer to
a question nobody asked.** That is why `wired.mjs` has a direction for it, and
why `tools/e2e/` has a test that reads the three rows rather than the registry:
a field is only worth a test if something visible hangs off it.

**A rating is a curve over the animal, and the curve is why the ladder has a top.**
`ratingOf()` is `total ^ 0.8 * 20` off the five attributes, and every rating in the
county comes out of it: the nine club snails are on 175 and the best snail in the
pool is on 666. **The old rating was a running average of the points you had scored**
- `START_RATING + (pts / races) * RATING_PER_WIN` - and its ceiling was **60**: twenty-
five points is the best average there is, so no amount of winning could take a snail
past sixty against nine club snails on 150. **Rank one was not reachable at all**, which
is why nothing that hangs off being first on the ladder could be built until this
changed. A rating is now the animal and the record - `races`, `pts`, `wins`, `avg` -
stays on every rival because the season draw leans on it.

**The pool is a ladder and not a plateau, and the top of its spread is `ATTR_MAX * 5`.**
It used to be `lerp(6, 158, ...)`, which could not be split into five attributes of
at most 16: the split inverted once it had more than 80 to give away, `lo` ran ahead of
`hi`, and roughly thirty of the sixty-four rivals came out with attributes above the
ceiling - up to six times a maxed snail on the road, because `effTraits()` does not
clamp them. **Clamping the sum alone made it worse**: every rung past the clamp came
out identical, so two thirds of the pool sat on exactly 666 and a GP field drawn from
it was eight snails the county agreed were the same animal. The spread now runs to what
five attributes can actually hold, which is a real ladder - 175 to 666, **56 distinct
ratings out of 64**, and every season band with rivals in it.

**A race moves a rating by the place you finished in, and the cup decides how much.**
`RATING_GAIN` is `[30, 20, 14, 9, 5, 1, -2, -6]`, `PODIUM_FLOOR` is a guarantee under
the podium, and the whole is multiplied by the season's `payMult` - so a GP win is 63
points and 60 rating and a Sunday Cup win is 25 and 30. **Five races at thirty a race
takes a fresh snail from 10 to 160, which is exactly where the Open's door is**: one
clean season is one rung up, the Invitational opens after a second, the GP after a
third, and by then the snail is on 655 and standing on the ladder's top rung with
nothing above it. **Three seasons to be first**, and the bands in `seasons.json` are
written off those numbers - move the gain and the four doors move with it. A podium
guarantee at `payMult` means a first place in the Snail GP is at least three times the
Sunday Cup's, so a cup that pays more pays a bad race no less.

**And a save from before the change is brought back rather than thrown away.**
`load()` clamps every pool rival's attributes into `[1, ATTR_MAX]` and re-derives the
rating from them, which is exact - `attrs` is in the save and `ratingOf()` is a pure
function of it - so an old episode's pool stops reading 1580 at the top. **`state.
rating` is not touched**: a player's rating is a career number with nothing to derive
it from, and the old scale topped out at 60 anyway, so a returning snail keeps what it
had and climbs the new ladder from there. The four cosmetic fields below are the same
argument, and none of it is a version bump: `v` stays 2 and a hat is not a reason to
throw away a season.

**Faces and hats are one table each, and it is *five* copies of the names that is the
cost.** `FACE_SET` and `HAT_SET` in `core.js` hold the prices and the rules, `MESH_SETS`
in `materials.js` holds the files, `meshes/maps.js` holds the map declaration, the glyph
list is a `.f-`/`.h-` rule in `snail-race.css`, and the bytes are on disk —
`tools/plan-test.mjs --faces` reads all five and fails if they disagree, because the
failure is silent. A rival wearing a name no file is behind draws as a snail with no
face, which is indistinguishable from a snail whose face is plain, and a name in four of
the five is a name the shop can render and the loader cannot fetch. **`price: 0` is a
starter and `locked: true` is the other half of it**: `devil` and `devil-horns` have no
price at all, because they are not bought, they are The Adversary's, and nothing in
`faceFor()` / `hatFor()` can hand them out.

**A hat is placed by the width of the head where it goes on, and not by how high the head
is.** `build-hat.html` has `headHalfAt()` for exactly this and it is the number two hats
were wrong on. The top hat's brim is a disc of radius 0.080 and it used to sit at
`BRIM_Y - 0.012`, which is `headHalfAt(0.074) = 0.0836` — **a 136 mm brim inside a head
167 mm across at its own station, which is why it read as no brim at all** and a top hat
with no brim is a can. The propeller's cap wall is `0.056` at `headHalfAt(0.082) =
0.0749`, so the cap's own side was **thirty-seven millimetres inside the head's own
width** — the wall disappearing into the skull, which is what "it clips through the head"
is. `headHalfAt` falls to 0.054 at `0.096` and that is where both of them went. **A flat
brim on a round head only reads once its outer edge is outside the head *at the brim's own
height*, and a head's half-width falls away fast above the equator** — so the two hats
that have a wall are placed by `headHalfAt` answering the wall's radius, and the two that
are only an annulus stay at `BRIM_Y`.

**And a lathe is a surface of revolution, so its winding is a measurement and not the
profile's direction.** The straw hat's crown was written `[0.006, y+0.058]` first and
`[0.062, y-0.006]` last — radius growing as the profile descends — and it came out
**entirely inside out**: `0 of 208 faces` agreed with the radial direction, the near wall
culled, the far wall showing from the inside, **and a straw hat you could see the head's
face through the crown of.** The bonnet on the same page is written the other way round
and was always right, which is the whole of the trap — **two lathes, one rule, and the one
that gets it wrong is a quiet answer**: nothing throws, no console line, and
`computeVertexNormals()` hands back normals pointing into the shell of it, which looks like
a shading fault and is not one. So `faceOut()` decides it per lathe and the preview log
names **which hat it had to reverse and how nearly it voted** — because a gate that
repairs silently is a repair nobody knows happened, and a build that reverses nothing is
the build where every profile on the page is written the way three winds them. **The test
is a majority and not a strict per-face one**: a crown's own top is a cone whose faces
point up, and a cone's normal has nothing to say about the radius at the point it sits,
so a strict test calls a correct hat wrong. And a wizard hat's spine is a **curve**, which
is why `faceOut()` takes the spine each vertex was built around rather than the head's
`y` — the same arrangement the snail's `sweep()` uses, for the same reason.

**A face is the whole face and a hat is a silhouette, and `plain` is the shipped face.**
Ten faces is a crowd rather than a uniform, and a snail's head is four centimetres
across at race distance - so the hats are the thing you read and the faces are for when
you are close to one. **`plain` is `eyeM`, `eyeM_1` and `smileM` rebuilt out of the
numbers `meshes/snail.html` built them from**, so a snail with nothing said about it
looks exactly as it looked before faces existed, and the other nine are `plain` plus
pieces: the eyes are never rebuilt, only ever covered. `meshes/build-face.html`'s
`onHead()` pushes every piece onto the head's own ellipsoid, because a brow placed at
the eye's `x` floats a centimetre off the side of the face at its outer end and
touches it in the middle, which reads as a smudge.

**And the wizard hat is the only hat in the county whose axis is not straight, so it is
the only one that is not a lathe.** A `LatheGeometry` turns about one straight axis, and a
wizard hat's spine leans out over the face and folds over and droops — **which is the
whole silhouette and the one shape none of the four primitives that page has can draw.**
So `bentCone()` is a lathe with the origin moved per station, and it is **rings that stay
horizontal while the centre moves** rather than rings square to the spine: a ring square
to a spine that has folded through horizontal is a ring lying on its edge, and a cone
whose rings do that is a paper hat folded flat, where a cross-section that stays level is
a soft hat sagging. **Its five stars are geometry and not a map** — a hat has no `uv` on
that page and a tiling map on a cone repeats the stars up the fold — and they are laid on
the cone's own surface with their normal *being* its surface normal, which is
`lean - 90°` and not `lean`: **a star built in the `xz` plane and turned by `-lean` lies
flat on a face at seventy degrees, and the upper four came out as silver dashes.**
**And the stars' heights are measured up from the brim and not written as absolutes,
because the cone's own station table moves every time the hat does** — absolute ones put
all five *underneath* the brim, the scan ran off the end of the profile, the radius clamped
to the brim's outer edge, and **the hat came out 1.68 metres across, seven head widths**,
with a flat blade sticking out of it.

**And the third of the pool wears it rather than nothing, which is a check being answered
rather than satisfied.** `hatFor()`'s last branch returned `none`, so **a sixth of the
field raced bare-headed**, and the `>= 4 hats reach the pool` assertion in
`plan-test --faces` was passing over a set with a hole in it. The wizard hat took that
branch and the pool is 7 wizard, 12 straw, 14 sunglasses, 11 bonnet, 9 top-hat, 11
propeller — **and no `none` at all**, which is the whole of what the count was for. An
existing save keeps its old dressing, because `dressPool()` only fills an absent hat and
a hat is not a reason to throw away a season.

**The Adversary is not in the pool and the ladder says so.** `adversary()` builds them
off `state.pool`'s strongest rival, so their attributes track the ladder as it moves, and
`id: -1` - which is why `finishRace()`'s duel branch has to come **before** the season
ledger, not after it: that block does `state.pool[r.sn.id].races++` on every row that
is not the player, and a duel that returned after it would throw on the last frame of a
fight the player had already won. A duel is one flag on `startRace()` and nothing else
is different: two racers, two lane slots at the two ends of the road, two crates,
three seconds more countdown, and a branch that writes no season record at all.

**And the ladder carries a row for them, because two screens disagreeing is the failure
that reads.** After a win `rankOf(state.rating)` is 1 and the stable says "1st of 65"
with no rival above it, while the ladder's own note says the count is one more than how
many of the other 64 rate above you. They are drawn as a row marked `here` and **not in
the ladder's counts** - which is why they can come and go without touching `rankOf()` or
`ladderAt()`. **A duel win is +60 and a loss costs the place**: one below the best snail
in the county if you were above them, and exactly what you had if you were not, because
there was no place of yours to lose. Written as `top - 1` on its own it read as a
*reward* for losing - a snail on 10 clicked the button, lost, and came back on 665.

**A rank is one more than how many snails rate strictly above it, out of the 64
rivals and you, so the player is counted as the 65th.** `rankOf()` in `race.js`
counts `state.pool` and then adds the player, because the pool is a ladder in
the literal sense — `makePool()` spreads 64 rivals over the whole range one per
rung — and the ladder says `of 65` in five places. Two other sets were available
and both are worse: the season band overlaps on purpose (`open` is 250–1000 and
`invitational` is 750–1500), so a snail on 800 would read 11th of 31 in one season
and 48th of 25 in the other for the same rating, which is a number about the pick;
and the field is drawn with a pull towards your own rating (`FIELD_BIAS`) and a
penalty on the seven you raced last season, so it is a fixture rather than a
standing and is redrawn every season.

**Counting the player is what makes `of 65` a promise the number can keep.** You
are not in `state.pool`, so without the extra term a snail on 810 reads 33rd
while you on 823 also read 33rd — and with 65 members on the ladder and you 33rd,
a 34th has to exist. **The price is that a rival's number moves when you pass
him**: Holl is 33rd while you are on 10 and 34th once you are on 823. That is
what a ladder is, though — it is one order — and the alternative is a number that
said 33rd on your stable and 34th on everybody else's, which is two standings
wearing one rival's name. **Two rows on different ratings can never share a
number**: for any two rivals the higher is counted in the lower one's total, so
the lower is strictly behind, and a rating above the higher rival is above the
lower one too, so the player cannot flatten it by standing between them. Checked
across all 64 and there are none, so the only snails that ever share a number are
the ones on one rating.

That tie rule is the rest of what stops it lying. `CLUB_SNAILS` of the pool are
the same modest snail — three of everything — and every one of them sits on
exactly **150**, so a fresh player at `START_RATING` sees nine identical rivals
140 points up and then a 270-point gap to anything else. Anything that invents an
order among equals is making it up: "Pike is 9th" says only that `p.id` is the
lower number, and the top five of the ladder modal would look decisive while all
five of them were on one rating. So a snail on your rating shares your number and
is counted separately, and what is given up is a clean 1–65 with no gaps — which
was never true: a fresh snail on 10 and a snail on 130 are both 65th, because
nothing on the ladder rates between them and 150. **Which is why the modal's note
states both**, rather than leaving the list to speak for itself.

And **a new game reading like a wall is a sentence and not a rung.** A fresh
snail is 65th of 65 with nothing below it, and the honest fix for that is a word
in the modal's note — `makePool()` is the seed `tools/e2e/baseline.json` captured
four races' finishing order and times to six decimals against, so a snail that is
not a club snail at the foot of the ladder changes every one of them.

**Everything is built in lane space.** A course is a list of samples along a
spline: `s` is metres along it, `d` is metres to the right of the centre line,
`y` is up. Every prop, every height and every colour is placed in that frame and
converted once by `laneVertex`. Nothing is placed in world coordinates directly.

**One course build serves both screens.** `buildCourse(catId)` makes the ground,
the road, the skirt, the water and everything scattered on it; `startRace()` and
`openInspector()` both call it, and `dropCourse()` disposes it. So a course
looked at on a card is the course that gets raced. If you add scenery, it shows
up in both, which is usually what you want.

**`scatter()` is the placement system.** It scales its count by course length
(`count * tr.length / 150`), and its `opts` are the contract worth reading before
writing a new placement:

| | |
|---|---|
| `at(sm, r)` | metres out from the lane edge, a random draw each try |
| `inWater` | may sit *inside* the pool rather than beside it |
| `clear` / `offLane` / `shore` | how close to the waterline, the lane and the shore it may come |
| `minGap` / `avoidGap` / `avoid` | metres of clear course it needs from itself and from named places |
| `tries` | draws allowed looking for room (default `want * 10`) |
| `parts` | the piece's parts, so a prop made of two surfaces is placed as both |
| `material` | overrides the material argument, per part, and is the one thing a caller can say so without the game looking anything up |
| `scale` / `tilt` / `tint` / `lift` / `skip` / `keep` / `onWater` / `shadow` | |

A part is drawn in **the material out of its own file** if that file has been
converted, and in whatever the call site passed if it has not. That is what
`propMatFor` is for, and it is why a converted prop needs no call-site change:
the loader registers each part's geometry against the material its own glb
declared, and `scatter()` finds it from the geometry. `partList('mossy-rock',
mat.rock)` is the one place a caller has to name a prop's parts, and it exists
because a prop of two surfaces cannot be placed as one.

`clear` is a **minimum distance out past the waterline**, not a tolerance
inside it. A water plant whose `at()` range lies inside the pool is rejected by
every draw unless it sets `inWater: true` — and it will silently place *nothing*
rather than throw. That has already cost one round of work twice.

**Order in `buildCourse()` is load-bearing.** `placeLamps()` runs before
`populate()` because the scattered lantern poles read `lampWalk` to keep clear
of the lamps. Swap them and the lanterns double up on the verge. The tower is
put down between the two, and `STANDING`/`RESERVED` are emptied *before* it, so
the clearing it claims is spoken for by the time the first tree is placed.

**The half-way is the middle of the clearest stretch of the course, and the
clearest stretch stops at the finish.** `midwayOf()` scores every run of plain
lane by `length - 3 * |centre - midS|` and takes the best, but the scan is
bounded to `[START_S, tr.finish]` and a run that reaches the finish ends *on*
`tr.finish` rather than on the next sample. The samples carry on past the line
into the run-out the finishing camera stands in, and on a water course that
run-out is the widest clear stretch there is: Lily Deep's is 24.8 m against the
band's 21, it won, and both the tower and the half-way line were built on the
finish line. A stretch the race never covers is not a candidate for its own
half-way mark however clear it is.

**The planner's `x` is not the track's `s`, and the half-way is placed in `s`.**
The plan reserves its middle band in design coordinates, where a sample's `x` is
the design `x` re-sampled along the curve; the two drift by metres, not by
rounding. The tower and the line are put down in arc distance, and the band the
plan cuts is by a long way the widest clear stretch on the course, so a rule that
finds the widest clear run finds the band without converting anything.

**`level: true` on a course levels the water course only.** The successive pool
surfaces are made level; the rolling meadow either side of them is not. A change
that flattens `groundYAt` for the whole course is a bug, not a bigger pool.

**Never put pure white in a small thing.** Ten-centimetre white reads as a
stone at race distance. The whole county's palette is `meshes/palette.js` -
`PAL` and `GREEN`/`STONE` in the game, `C` in the builder, and the texture
builder all read the same jar - and a new colour should look like it came from
it. Nothing outside that file may invent a colour.

**The ribbon's rows are `roadRows()` and not the samples, and that is load-bearing
for the two lines across the lane.** `roadRows()` is one row per sample and
**four more at each mark** — the start and the half-way — packed at seven and five
centimetres either side of it, which is the same bargain `TRACKC` strikes for the
columns of the edge stripe and for the same reason: a vertex colour cannot draw a
seven-centimetre line on a row 0.75 m apart, it draws 0.75 m of gradient, which is
a worn edge and not a stripe. So `buildRoad()` reads the row's own `s` and asks
`trackAt()` for its frame, and a packed row has no `sm` of its own.

**The paint is a share of the row's distance to the mark, and not a flag on the
four packed rows.** A flag says those four rows *are* the line, and a sample row
that happens to fall four centimetres from the mark is not one of the four, so the
line comes out with a bare stripe up its middle — and on a course whose samples
are 0.75 m apart and whose marks are at 11 m and at whatever the half-way scan
found, a five-centimetre hole in the start line is a coin toss. The tell is a
painted band with a gap in it when the two halves do not quite meet.

**The chequered band the lines replaced was the black box, and it was a buffer
read past its end.** Ten boxes a lane wide, `C * 4` = 40 vertices, and an index
list reaching `a + 7` on the last column, which is vertex **43**. An out-of-range
index is not a hole in the picture, it is whatever the driver had lying there, and
with a bloom pass over the frame that is a black box the width of the course at
the start line and another at the half-way, and a third wherever the camera
crossed one: the same camera measured **40.7 of 255 mean and 49.9 per cent of the
frame black** with the two bands in and **98.9 and nought** with them out. Nothing
about the band's colour or its size was ever wrong. The tell is a black rectangle
that is a rectangle in *screen* space and is only there when the bloom is on.

**The course surface is not a prop.** The ground and the cliff have no uvs: they
are built along the spline and their colour is sampled in world XZ at four
frequencies, so their detail normal is triplanar, injected into `mat.course`,
`mat.road`, `mat.ledge` and `mat.grass` through `onBeforeCompile`. **The ribbon and
the flank are the exception**: they carry a `trackUv` — metres along the lane in x,
metres out from the centre line in y — and `triplanarSets()` takes `uv: true` per
set, so the clay's grain runs *with* the turn of the road. It is not a `uv`
attribute because three reserves that name. The water is
built row by row down each pool and does get real uvs, plus two ripple normals
scrolled against each other. `mat.water`'s two samples are combined in the
shader, not by three, so there is one tangent frame to think about rather than
two.

**The course is four surfaces, and a per-vertex weight is what tells them apart.**
`buildGround()`, `buildRoad()` and `buildSkirt()` each return one mesh, and the
vertices are shared across every join so `computeVertexNormals()` gives the whole
surface one set of normals — a split into separate meshes draws a seam along it.
What used to be index groups and several materials is now one material each and a
`detailW` attribute, and the reason is the whole of this paragraph: **a vertex
colour can be faded halfway and a material cannot.** A group boundary is a row of
pixels where the maps change, and grass blades on one side of it and rock joints
on the other is a full-strength change in that row, so however carefully the colour
was laid on the halfway point the line was still there. So the surface is one
material, `mat.course` carries **turf, cliff and shore** and the others carry two
apiece, and the shader sums each set's slope and averages each set's colour by the
weights the geometry carries. The four surfaces are turf, rock, sand and the
climbing ramp, and they are the **gain** that separates the last two rather than
the material: the same cliff map at 1.3 is a ramp and at 1.0 is a face.

So there is no halfway-point rule to keep in step any more, and that is a relief:
the rule only ever governed the material, and the colour was always faded by
`bare`, `shore` and `trodden` on their own. The weights **are** those three
numbers, written out for the geometry rather than asked of it a quad at a time,
and `rampShare()` is `isRock()` smoothed over a metre and a half so the two ends
of a wall meet the road in a gradient rather than a line. The transition is one
**quad** wide and a ramp across it — a metre beside the lane where the rows are a
metre apart, a few metres out in the country where they are not — and there is no
way to make it narrower without finer geometry, but it is a blend and not a seam at
every width. Each set is guarded on its own weight, so open meadow pays for one set
of three projections and a pool's edge pays for two.

**The shore weight has three callers, and all three are sand.** A pool's own band
and the walkable terrace at the top of a wall are two of them; the third is the
band of sand that rakes out of a course's flank into the meadow. That last one is
the rule that catches people: a band that lays `PAL.sand` on the vertex colour and
leaves the weight on the turf is a metre of beach wearing `grass-albedo`, which is a
join as visible as the one it was meant to remove. **Colour and weight come off the
same number** — read `sandShare` (which is `1 - rampShare()`, the number the flank's
own two materials are cross-faded by) for both, or the band is a decal.

**A lip is a crease, and the guard that protects it covers the whole hole.** A leap's
lip is the one thing on the course that says where the launch is, and `smoothRidges()`
is a bounded Laplacian over the lane's heights whose entire job is not to round that
crease off. It used to skip samples next to `FLY` only — the air over a *pool* — and
a dry leap's gap is `WALK`, so the chasm floor counted as ordinary road and got
smoothed into the take-off edge beside it. The result is a `leap` whose whole profile
is a shallow slope that never reaches the launch height, while a `leapClimb` on the
same course keeps its ledge, from one number and with no error anywhere. `inHole()`
now guards both, because the floor of a hole is as much a break in the lane as the air
over it. The tell is `plan-test.mjs sky --leaps`: **the lane height at the take-off
edge must equal the lip's planned height.** It came out **0.56 to 0.90 m low** on every
dry gap and is now exact — and note the *sim* always flew from the planned height, so
this was the road sitting below where the snail launched from, not a smaller jump.

**A crate's notch is cut in the arc and in the geometry, and not in the planner and
not on the lane's own field.** The hole is one lane sample deep and its two lips are
the midpoints of the gaps either side of it, so on Crag Ascent it is **0.750 m of
arc** with **0.670 m** of flat floor and a crate of 0.62 in it with 25 mm of slot
showing either end. It used to be laid out in design `x`, where a metre and a half
came out as **1.68 m of arc** on that bend, so the floor was three samples long and
the box stood at one end of it — `x` is a design coordinate and the box is a thing
in the world, and no amount of choosing `x` well makes one the other. Cut at the
right sample it still came out rounded, because **`trackAt()` interpolates and the
field between two samples is a straight line**: the lane comes out of the notch at
0.65 m over 0.75 m, which is **41°**, and four more rows laid on that field are
four more points on the same 41°. A wall has to come off the line, so the four rows
carry a height of their own — the road's own level at each lip and the floor's
level below, both read off the track — which is the same bargain as `row.paint`: a
row may carry something the sample spacing cannot say, and the surfaces built off
the row list are the ones that read it. The walls are **81° and 82°** on Crag
Ascent and **81.7° either side** on Grand Marathon, which is the whole difference
between a hole and a crease.

**A row that brings a height brings the answer with it, and all three surfaces have
to read the same row list.** `rowRows()` grew packed rows and `rowFrame()` grew a
function rather than a line repeated in three places, because the ground's height is
a *function* of the frame it is handed — `groundYAt()` reads `fr.y` for the lane's
own level, for the drop it measures a wall from and for the shelf it lays beside it
— so a ribbon that read `row.y` for its own vertices and handed the untouched frame
to the ground would put a metre of terrain over its own hole. What the frame *is*
matters as much: the two rows at the top of a notch's walls are nearer a sample of
plain road, so the field calls them road, and one line that did not copy `row.cond`
across left the notch with a clay rim, meadow grass either side of it and
`wallProfile()`'s wide terrace laid underneath — the dish again, out of one
assignment. `wallProfile()`'s `PUSH` branch is asked **before** the drop and not
after it, because neither of its two numbers is a function of how far the lane
stands above the hillside, and a guard in front of it takes the narrow profile away
on exactly the stretches where the two levels are nearest.

**The planner's dish goes back on the road, because a lip is a lip and not the start
of a ramp.** `buildTrack()` finds the first sample of plain road either side of the
floor and lays the road across the notch as the straight line between those two,
and every sample of the dish between them that is not the floor is put back on it.
It was not, and the rise was still being drawn **0.19 m past the far lip** on Crag
Ascent: a fifth of a metre of trough running off the hole, which is a rounded dish
by another name and is why the notch read as washed out with the walls already
square. The lips stay at the samples the floor is *between* and not at the two the
road is measured from — reach out to the far shoulder to measure the road and Grand
Marathon's notch came out **1.12 m of arc** with a metre of flat floor, twice the
crate it is cut for and 210 mm of open slot either side of the box.

The apron is the other half of the obstacle, and it is eight lanes at 657 mm of
pitch with a 620 mm cube in each: **37 mm of air, and the field does not hold the
slot it was given** — it drifts a snail 120 either side, so neighbours met with
**200 mm of overlap** and a row of boxes that walked sideways down the road as it
went. So the road opens to a half-width of **3.5** over the whole shove — 857 of
pitch, 240 of air — and **the field's lane is a share of the half-width rather than
a distance off the centre line**, read off `fr.w` at 0.75 m, because a lane slot
written down in metres cannot follow a road that changes width. The wander is read
off the same number, so it reaches nothing exactly where the road is widest: a snail
with its hands on a box walks it straight, and the general form of that is **a prop
placed from a lane has to be placed from the lane and not from a constant** — the
same formula has to reach the inspector's `buildCrates()` or a course you can walk
is not the course that gets raced. The tell, if it comes back, is a row of crates
that is even but too close: measure the gap between neighbouring `r.lane` and not
the width of the road.

**A wall is a step, and it is three pieces and not a ramp.** `groundYAt()` used to
ease the lane's own level out to the terrain across one band, which is a straight
line, and a straight line from the top of a wall to the bottom of it is a rounded
slope: a four-metre wall came out as five metres of thirty-six-degree hillside with
the road lying on top of it. So there is a **shelf** at the lane's own level
scaling with the height of the wall, a **face** a third of the drop wide and
therefore standing at fifty to seventy degrees however tall the wall is, and the
country easing out of the foot of it. The face is a **plane** and not a smoothstep,
because a smoothstep rounds both ends of it and a rounded end is the whole of what
went wrong. The sign of the drop is not consulted, so a road cut into a hillside
gets a bank and a road perched on one gets a face, and neither is a lump.
`wallProfile()` holds the two widths so `groundYAt()` and `vergeBand()` cannot fall
out of step about where the turns are — the packed rows follow it, which is what
puts the creases where the geometry is.

**A basin is a shape and the water is a separate fact about it, and the ground
has to ask both.** Inside a basin `groundYAt()` answers with `basinY()`, which is
the **floor** at the centre line and the country's own level a metre out — right
for a stretch of lane a snail swims across, and wrong for every other stretch that
has a basin. The guard in front of it only asked about the water, and the two do
not end together: the basin's radius is stamped over a pool's whole gap and the
water over the part of that gap the water is in, so at the exit of a pool there is
a stretch where the basin is still a basin and the water has already run out —
**6.06 down to 0.16 of a radius over a quarter of a metre of lane** on Lily Deep.
`buildWater()` has always asked the other question (`wy === null` skips the run)
and the ground did not, and because `b0` collapses to the radius itself at a radius
that small the answer was the floor at `d = 0` and the meadow a metre out: **0.370 m
of terrain lying across the whole width of the road, at the exit of each of the
course's four pools.** It read as a berm. **A stretch of lane with a basin and no
water in it is a pool's exit ramp, and the lane stands on the bank.** The tell is
ground answering higher than `fr.y` anywhere on `|d| <= w`, and
`tools/e2e/surface.spec.js` asks that of every row of every course and then raycasts
the built meshes against the ribbon, because a band of meadow over the road is not
a picture any picture test could have called wrong.

**A ramp is not a face, and that is a gain and not a material.** `cliff-albedo` is
a darkening map, because a face is weathered a long way below the top of it.
`buildRoad()` stops at `FACE_SLOPE`, so everything the road draws in rock is a ramp
of at most fifty-eight degrees — and at a low sun a ramp that stands up to the
light next to a face that stands across it is the whole picture, and in one
material the climbing road came out as a black wedge on a green hillside. The
ramp's set is the same normal and the same **map** as the cliff's at a gain of
**1.3**, which takes the weather off it without taking all of it off: the map
averages 0.57 linear, so 1.3 lands it near 0.74 and the ramp stands up out of the
face as a worn road. The face is weathered and the ramp is not, so the one takes
the darkening as it stands and the other takes the same file lightened. The
skirt's rock *is* a face and keeps the weather, which is the one number that makes
`mat.ledge` and `mat.road` two materials rather than one.

**A face and a cobbled road are two fields, not one map at two gains.** The old
`cliff-*` set was a set of cobbles — courses of setts laid on their side, which
is a road — and it was worn by the face as well as the ramp, so a wall came out as
a path with a drop beside it however far off the weather was gained. It is now
`cobblestone-*`, byte for byte what the cliff was, and **nothing wears it**: it is
declared in `SURFACE` so the builder and the inspector know the file exists and
so it is one drawer away if a road ever wants it, but there is no `detailOf('cobble')`
and adding one is the change that puts the masonry back on the cliff. The face is
`cliff-*` again and is a different field, built the other way round. The load-
bearing part is what it is **not** drawn from: a cellular lattice closes every
cell on all four sides, so a face built out of one is a net of closed cells
however good the cells are, and a net of closed cells at this scale is the cobbled
road under a new name — the same word as crazing and the same failure. So the
joints are a **one-dimensional lattice, five grooves to the tile**, each with its
own width and its own place inside its own cell, and each **thresholded shut over
part of its own length** so a joint dies and restarts and a good part of the face
carries no joint at all. A smooth multiplier is not a substitute for that
threshold: at `(0.40 + 0.60 * cont)` the joint never reaches zero and five faint
full-height lines are still five lines. The flat planes come from a coarse 7-by-5
lattice used the one way a cell can be used without becoming a net — every cell
gets a **flat value of its own** and the boundary is a change of plane, with
`plate` absent from `crack` and kept that way, because a value discontinuity is an
edge and a *darkened* one is a joint. **The weight in its normal is the groove and
not the plane** — `crack` at 0.40 against `rib` at 0.24 and `pval` at 0.12 —
because both references are lit planes beside near-black gaps and the gap is what
makes a plane read as a plane; 0.40 rather than the 0.56 it was, because a groove
weighted past the depth it has is a drawn line and a face of drawn lines is a made
thing. The albedo darkens a groove at 0.60 for the same reason. The cobbles'
weight is the other way round: the block at 0.32 and the gap at 0.44, over a
bedding that is a third of the map. That reversal is the whole of what separates
the two files, and it is why the rename alone changes nothing and the rebuild
changes everything.

**The gain is how much weathering to take off, and "all of it" is not an answer.**
1.75 is the map's mean put back exactly, and it is arithmetic with no judgement
in it: the mean lands on one, the top of the range goes to 1.45, the pale plates
clip, and the climbing road came out as pale limestone lying on a dark basalt
cliff. The bright end clipping is the price of the range being stretched rather
than flattened, and it is why the cliff's map is built as narrow as it can be —
adding the facet's value put this one's natural mean at 0.74 with the red channel
clipping over four hundredths of a percent, and the answer was to narrow the
weights and bring `CLIFF_CAL` back to 1.021 rather than to gain 0.74 down, because
a gain that wide takes the darks with it.

**A normal map is shape and not value, so a surface wearing one and no colour
has nothing left to shade.** That is what `mat.ramp` was for a while: the
cliff's normal, no colour at all, and the climbable stretch of the course came
out a black hole with the cliff's own texture showing at its edges where a
grazing light caught the relief. A detail normal can only ever subtract from
what a surface already has, and a face turned away from a nine-degree sun has
nothing to subtract from — the rock has to be *in* the material, not only on
it. This is the one thing a second look at a "black" surface should rule out
first, and it cannot be ruled out from the material at all: tint a black
multiply any colour you like and it stays black.

**A map built under one is bought back with a gain, and the gain is the whole of
what a surface wants.** `cliff-albedo` averages 0.57 linear because a face is
meant to be dark; the turf's is gained at 1.20 and the shore's at 1.35 for the
opposite reason, and the ramp's at 1.3. Three surfaces, one file each, and the
value a surface wants is the gain and not the map — so a fourth surface that
wants the same grain and a different value is a gain, not a fourth file. The
cost is that the bright end clips, which is the price of the range being
stretched rather than flattened and is why the cliff's map is built as narrow as
it can be.

**A surface with no uv can only be given a normal map, never a roughness map.**
`triplanarDetail()` rewrites `normal_fragment_maps` and nothing else, so it is
the only slot it can honestly fill. `roughnessMap`, `map`, `emissiveMap` and
`aoMap` are all read by uv, and a missing attribute is not an error in WebGL:
it is the default `(0,0)`, so the surface gets one texel of the map, forever.
That is why `mat.course`, `mat.road`, `mat.ledge` and `mat.grass` carry no
roughness map even though `ground-rgh`, `track-rgh` and `cliff-rgh` are drawn and
shipped — grass is uniformly rough, so the half of the pair that would have done
nothing is better off in the folder than on the material.

**A surface with no uv can be given a colour detail, and the ground, the road and
the tufts all are.** `triplanarDetail()` also rewrites `color_fragment`, which is
the one slot after the normal that a surface without a uv can honestly fill, and
what it fills it with is a *multiply* — a map built about white, with its mean
put back by `detailCGain`, cannot take the county's hue away from the vertex
colour underneath it. A vertex colour every two metres is worth having and holds
nothing finer than the patch it was sampled from, so the map is the half of the
colour that a vertex cannot draw. `SURFACE.grass` has to list `grass-albedo` or
`detailOf('grass', 'map')` comes back empty and `triplanarDetail()` returns early
**without a word** — the material comes up wearing only its normal, and the
stable's lawn, which asks `SURFACE.ground` for the same file, is the only green
surface in the county that looks right.

**The grass is triplanar, and it is the one thing that needs a different
scale.** `mat.grass` has no vertex colours and a tuft has no uv, and there is
nowhere to put one on six thousand of them, so `triplanarDetail()` projects it
the way the course surface's is projected — but at `0.7`, a one-and-a-half-metre
tile, against the ground's five. A tuft is a third of a metre across and a stem
in `grass-n` is a hundredth of the tile, so that is the tile that puts a
centimetre-and-a-half stem on a tuft; the ground's would put a four-centimetre one
on the grass and the tuft would read as a smooth cone. The two numbers are the
same number and the map was drawn for both, so the **frequency and the tile move
together**: change one and the stems change size, which is the mistake a
resolution bump on its own makes.
`triplanarDetail()` takes the projection from the transformed vertex and, under
`USE_INSTANCING`, the axes from the instance matrix, so each of the six
thousand samples the map from its own place in the county. Projecting from
`modelMatrix` alone is the bug that makes one blade stamped six thousand times.
The stage disc is still on `ground-n` for its normal and `grass-albedo` for its
colour, on two different tiles, and that is the one place in the county they
disagree: a hundred-metre disc lit by a camera a metre and a half off it wants
the coarser grain in the normal and the finer one in the colour.

**A detail map's strength is a function of its tile, and the two are chosen
together.** The ground's turf normal was at 0.25 and read as nothing: two degrees
of slope is a value change, and a vertex colour already has one. It is 0.3 now
against a map rebuilt at 1024 with the relief in thin lines rather than in
lobes, and that is the part that matters — a line the width of a stem shades as
texture, where a facet that size shades like a chip of stone and a mat of grass
stops being a mat. The same rule put `grass-n`'s builder strength at 1.75, and the
number is not comparable with the old 2.5 on its own: the map now carries a broad
patch relief underneath the stems, so the strength came **down** and the tilt went
with it, from a 32° mean the docs claimed was 22° to a 22° one. Stopping it much
higher **saturates** the packing: at 8 the map reports 30° and is two values, 0 and
255, and reads as scratches. The texture page prints the tilt for every normal map
it draws, and anything under 4° is too flat to see.

**A quad is two triangles off one diagonal, and a grid's perimeter is not the order
its indices come in.** The snail's shell is a tube swept along a spiral and the snail's
body is a tube swept along a spline, and both wrote their quads the same one-line way
round — `(a, b, c)` and `(a, c, d)` for a grid indexed `a = (i, j)`, `b = (i, j+1)`,
`c = (i+1, j)`, `d = (i+1, j+1)` — which is **a bowtie**: the first triangle splits the
quad along `a-c` and the second along `a-d`, so they share no interior edge and every
second triangle is inside out. It renders as a lattice of light and dark diamonds the
size of the tessellation over the whole surface, and nothing looks wrong: the stored
normals are smooth, the material is fine, and a normal-map check sees a clean map on a
clean surface. **The test is per face and it is one line** — every face's geometric
normal dotted with the normal its own first corner carries should be positive, and a
bowtied grid gives you exactly half of them agreeing — and `build-shell.html`'s preview
prints it, because a check that is only run by whoever trips over the fault is not a
check. Winding a surface and trusting your own hand about which way is out is the same
mistake: the shell's index buffer is reversed in code when its signed volume is
negative, which is the right decision and **the wrong question**.

**And the signed volume is a sum, so it cannot see a small set of faces the wrong way
round.** The snail's body and foot were both built by `sweep()`, which wrote its quads,
measured the whole index buffer, reversed it, and **then added the two end caps by hand
with no measurement behind them at all** — so the quads went one way and fifty-two faces
of the body's two caps plus forty of the foot's went the other. The preview printed its
green tick: **2.4 × 10⁻² is a comfortably positive number describing an animal with four
holes in it**, one at the front of the body, one at its back, one at each end of the
foot. The count is the arithmetic and it is not subtle — two thousand good faces drown
fifty bad ones — and **a body that is see-through at its ends is not a shape anybody
reads as a winding fault, because the middle of it is still solid and looks perfectly
well.** So the poles go in *before* the test and the one decision covers all three
blocks, and so the gate is per face: `sweep()` records the spine point each vertex's
ring was built around and `outwardReport()` compares every face against it, which is a
reference a winding mistake cannot agree with by accident. **The volume stays printed
beside it, unsigned of any claim, because a mesh that went inside out entirely would
move its sign and that is the one thing worth seeing.** The general form: **a check that
answers a question about the whole cannot answer a question about the part, and the
part is where closures, caps, fans and lids live** — which is every place a surface is
joined to something rather than continued.

**And an end pole is a distance and a fraction, and not a point.** A sweep closes its
two ends with a fan off a single vertex, and a pole given in full can disagree with the
ring it closes — the body's front pole was twenty-nine millimetres above the ring's own
middle, and **a fan off a pole that is not at the ring's centre is not a taper, it is a
flat sheet the length of the animal** lying out sideways from its end: two pale sheets
and a hard edge between them and the body, which is what "the body looks inside out"
turned out to be on a snail. Nobody can see the fault in a wireframe because the wire
frame has no shading and the sheet is not a hole. So `sweep()` takes `tailX`, `frontX`
and a `poleY` fraction and reads the height off the end ring it closes — **and the front
closure is a jaw and not a ball it hides inside.** It used to be placed inside the head's
ellipsoid for the old reason, that a closure has to be somewhere the surface cannot be
seen, and it cannot be once the front of the animal is raised: the head is 269 mm across
and the throat in front of it is 138 deep, so a ring small enough to fit the ball is a
stalk. So the front cap is 14 mm deep on the throat's own ring, the head covers its
upper 37 mm, and what is left showing is a rounded face under a chin — **an animal's jaw,
and the thing that made it a hole was never where it was.** **A closure has to be
correctly wound before it has to be hidden, and the order of those two questions is the
whole of it.**

**And the shell is the reference model's own, and there is one of them.**
`references/snailRef.glb` is a Sketchfab import of a whole snail and it arrives as **one
mesh, one material, 538 triangles** — the foot, the head and the coil are three hundred
and ninety-two triangles of body and one hundred and forty-six of shell, in a single
soup with nothing in the file to say which is which. **A shell is not a mesh in that
file, so there is no name to select and nothing to keep**: the first version of
`build-shell.html` took the first mesh, exported it, and shipped the snail inside the
shell. So `splitIslands()` cuts the soup by shared vertices and **`pickShell()` takes
the island that stands up** — a foot lies along the ground and its height is its own
thickness, while the coil is a dome over it, which in that file is **392 triangles 1.09
tall against 146 triangles 1.34 tall**. **Both numbers are logged every run and the
`islands` button draws them**, because a rule that names no number is a rule nobody can
check. `extract()` then gives the island its own index buffer and its own vertex list,
because **carrying the whole soup and hiding the body would ship the snail inside the
shell file** — it would be in the file, and the moment anybody swapped the tint the
snail would come back as white.

**What came out of that is 146 triangles, and the whorl is the map's job.** The coil the
log-spiral builder wound was 7,788 triangles of geometry carrying a pattern that three
files held between them; the reference is a smooth dome with the spiral left in its
texture space, and `shell-n`'s growth lines and `shell-tone`'s suture draw it. **That is
the same bargain the county struck for a cobbled road and a cliff face** — one file per
surface, the value a surface wants is the gain, and a pattern is a map rather than a
second mesh. The three whorls went with it: `shell-bands`, `shell-swirl` and
`shell-spots` are one `shell.glb` now, the key is the bare name because
`props['shell-' + style]` was a place where the file could be called something the
loader never fetched, and **the shop's row of three buttons went with them** — a picker
with one thing in it is a button that lies.

**And the shell is an open cap, which is the landmark the whole orientation hangs on.**
The first attempt read the shell's two ends off two things it guessed at: the vertex
nearest the unwrap's `APEX` for the spire, and the vertex furthest from the middle for
the mouth. **Both were wrong and neither looked wrong** — the file came out a striped egg
standing on a back, which reads as a shell balanced rather than a shell worn, and the
tell is that **the furthest vertex from the middle of a dome is not its mouth**; it is
whatever part of the rim happens to stick out. So the mesh is asked instead:
**an edge used by exactly one triangle is a hole, and this island has 32 of them** on a
loop of 32 vertices — the aperture, cut open where the sculpt's shell met its body. That
loop gives both ends exactly: its best-fit plane is the mouth, and the vertex furthest
from that plane on the material's own side is the spire. Measured, the mouth faces
`(0.66, 0.72, -0.23)` in the sculpt's frame and the spire stands at `(0.97, 0.24, 0.10)` —
**near-antipodal, which is the answer to whether these are the right two ends**, because
the axis of a coiled shell runs from its opening to its point and two directions 142
degrees apart is a shell.

**And the file is turned there and not in the mount.** `finish()` puts those two measured
directions against two written ones — `SPIRE_WANT` up-and-back and `MOUTH_WANT`
forward-and-down — with `basisOf()` making each pair an orthonormal frame and the rotation
carrying the first onto the second. **The spire is fitted exactly and the mouth as well
as it can be**: they are 133 degrees apart here and 142 in the file, no rotation makes
both exact, and `basisOf` projects `MOUTH_WANT` into the plane perpendicular to the spire,
which is where a rigid shell's mouth has to end up anyway. **There is no free parameter
left to be wrong in, and both ends are logged either side of it** — *after: spire
`(-0.22, 0.98, 0.00)`, mouth `(0.83, -0.55, 0.00)`* — because a rotation that is wrong here
is invisible in a still and obvious in a race. **The tell is a direction and not a look.**

**And an open cap is free in a single-sided county, for one reason.** The hole faces down
and forward into the animal's own back, so there is nothing behind it to see through: the
one thing a single-sided surface cannot survive is a back face at an angle the player can
get to, and this one is a mouth pressed against a body.

**And the mount is a position, a scale and one rotation, and the rotation is the only one
of the three that is a decision.** The shell file arrives in the animal's own frame — long
axis along +x, spire up-and-back, aperture forward-and-down — so the mount carries two
zeroes and not a full turn, and it is not a neutral default: the log spiral before it was
wound in the xz plane with its axis along +y and wanted `[-2.62, 0, 2.59]` and a comment
beside it full of sentences about standing a coil up. **A rotation that stands a dome up
is a rotation that puts it on its side.** *Which end of this thing is the spire* is a fact
about the model and not a decision a mount gets to make. **Which way that shell leans on
*this* back is a decision**, though, and it was made by measuring: **the shell's front lip
stands about 90 mm clear of the body's back at `rz` of zero, and a 90 mm notch between
the shell and the head is a hole in the silhouette whatever the head is doing.** Twelve
degrees of nose-down brings the lip onto the crest and drops the aperture from 35 to 47
degrees so the back fills more of the mouth, and it lifts the spire's tail by about the
30 mm the front gained — **so the price is paid at the spire, which is up in the air anyway
and which nothing in the silhouette can see standing off anything.** **The tell is a
direction and not a look, but not every direction is a measurement.**

**And a bigger head is `headG`'s scale and never the ball's own radius.** `build-face.html`
and `build-hat.html` both write `HEAD_R = 0.112, HEAD_SY = 0.97, HEAD_SZ = 1.02` and hang
every one of their pieces off those three numbers, and `build-hat.html`'s `BRIM_Y = 0.082`
is one of them — **so a bigger ball is a change to sixteen glb files and a bigger `headG`
is not.** Everything that makes a head a head is a child of that node: the ball, the two
eyes, the smile, both feelers, and whatever `race.js` has hung on it this visit, so one
scale takes the face, the hat and the propeller up with it and every feature stays in
proportion to the ball. **A number the whole wardrobe is built against is a number the
whole wardrobe's scale point can carry**, and the general form is that a parameter's
right home is the node every dependent measurement is expressed in rather than the
geometry at the bottom of them.

**And a head that grew over a neck that did not is a lollipop.** Scaling the head twenty
per cent takes the ball to 269 mm across and its rear pole forward to `0.136`, and **the
step under the chin goes from 54 mm a side to 76** — which is the balloon-on-a-stick the
head's own comment has always warned about, and the price of the bigger head rather than
anything to do with the shell. So the last three of the neck's half-widths carry the
head's share of that growth on top of their own taper, and the shell moves *back* fifty
millimetres rather than shrinking, because **a bigger head arrives forward and a shell
that had not moved would have been inside the animal's face.** **The tell that a size
change was finished is the neck, and not the thing that was resized.**

**A snail's maps were declared, fetched, uploaded and bound to nothing at all.**
`src/materials.js` skips the snail file outright — `if (name === 'snail') {
snailTemplate = root; continue; }` — because the snail is a *tree* of thirteen meshes
and every other file in the library is one mesh, so `applyMaps()` never ran on it.
`snail-n`, `snail-rgh`, `shell-n` and `shell-rgh` have been in the manifest all along,
loaded at boot, and attached to no surface in the game: **a snail was drawn in four
flat vertex-coloured tones with no grain on it and nothing to reflect but the dome.**
`makeSnail()` now hands its four hand-built materials the maps itself, and the entry is
in `maps.js` because it is the record of what a snail wears and because
`tools/inspect.html` audits it — **and because a piece that is a tree is a piece whose
maps no generic path can reach, which is a fact worth writing down rather than a bug
worth fixing.** `roughness` is 1 on those four materials and not the 0.35 they used to
carry, because a `roughnessMap` multiplies and the maps hold the whole value: the old
scalar in front of them put the whole field between four and twenty per cent and every
racer in the county would have come up a mirror.

**And the snail is the first thing in the county worth tracing, at four and a half per
cent.** The reflections row could only say `pools` and `cube` before it, which is what
the note on `reflectReport()` was written about and could not do; `makeSnail()` stamps
the mark on the body, the head, the foot, the two feelers and **all three whorl files**
rather than the one in `snail.glb`, because the geometry is swapped per racer and a mark
on the template is a mark on a buffer nothing reads. The number is a reflectance and not
a strength — a wet snail is a dielectric and returns four or five per cent straight
into it, the same as the water on a pool is two — so what the march gains is a snail
catching the sky on its own shell, and not a chrome animal.

## Models

A model is a `.glb` in `meshes/` that the game can draw as a prop. How that file
came to exist is not the game's business: the builders in this repo are one way
in and a convenient one, but anything that produces a valid glb is equally
welcome — another script, a modelling package, a generated or scanned model, a
hand-built `BufferGeometry`. Use whichever route does the job best. What matters
is the file, and it has to satisfy the loader at `src/materials.js:131`:

- One file per prop, named after the prop, and its mesh named the same, or
  `<prop>-<part>` where a part of it needs its own material. The dash is not a
  dot, because a dot does not survive a glb. The first mesh is the piece itself;
  any mesh that is neither it nor a named part makes the file **rejected**, and
  a file with no mesh in it at all is rejected too.
- `position`, `normal` and `color` attributes. The game does not fill any of
  them in: a missing `normal` means unlit-looking geometry, and a missing
  `color` means the prop draws **pure white**, because that is what three.js
  substitutes for an absent vertex colour.
- **No embedded images.** The game keeps the glb's *material* now, and attaches
  the maps by name out of `meshes/tex/` through the one manifest in
  `meshes/maps.js`. A texture baked into the glb is one the game cannot swap or
  leave out, which is the whole reason maps live in a folder. A `uv` attribute
  only where a map is wanted: a base-colour or normal map is sampled by uv, and
  a prop with no `uv` simply cannot have one — `tools/inspect.html` reports
  `uv layers` and a `0` there is the answer to why a prop has no maps.
- Scaled in world units, so nothing needs scaling into place: a stone is about
  1.2 m across, a hut is a hut, a snail is a snail. `scatter()` does apply a
  per-instance `scale`, but that is a variation, not a correction.
- Smooth shaded is the house style, and a flat-shaded model is not rejected — it
  is just not what the rest of the country looks like. Smooth shading means the
  geometry has to hold the shape up on its own.

Wiring one in is two steps and both are mandatory: the name goes in `MESH_FILES`
in `src/materials.js` — a file that is not in that list is not loaded at all — and
something places it, usually a `scatter()` call in `populate()` with
`mat.rock`, `mat.foliage` or `mat.vcol`. Read that section of *the rules that
bite* above before writing the second step; the options are easy to get wrong in
a way that places nothing and says nothing.

**If you are replacing a model, copy the old one into `tools/backup/` first.**
That is what the folder is for, and it is the only way to answer "is it the
right size" and "what did this change" afterwards. `rock.glb`, `mossy-rock.glb`
and `bush.glb` are in there from the PBR conversion; the older four shells and
the snail were already there. Nothing else has a backup.

### The builders, if you want them

`meshes/build-scenery.html`, `build-shell.html`, `build-snail.html` and
`build-textures.html` are pages of three.js that write glbs and maps, and
`tools/serve.py` serves each of them with an export hook that POSTs the bytes
straight into `meshes/`:

    window.__sceneryExport('lantern-arch')     // -> meshes/lantern-arch.glb
    window.__shellExport('shell', 'shell.glb')
    window.__snailExport('snail.glb')
    window.__texExport('rock-n')                // -> meshes/tex/rock-n.png
    window.__faceExport('cheer')                // -> meshes/faces/cheer.glb
    window.__hatExport('straw')                 // -> meshes/hats/straw.glb

Open `/_harness/face.html` and `/_harness/hat.html` and press a button, or run
the hook in the console. **Those two write into subfolders, so `dir` is a key of
`SAVE_DIRS` in `tools/serve.py` and not a path in the name** - `basename()`
flattens the name and a face posted with `dir` omitted lands beside the glbs.

Open `/_harness/scenery.html` and press a button, or run the hook in the
console. Useful because the detail is in the geometry: `stone()` gives a
faceted, noise-displaced boulder, `spray()` a leafy twig, `leafGeo()` a four
triangle leaf, and the `C` palette keeps the colour in the county's jar. Their
`part()`/`grad()` also flatten the index, which `mergeGeometries()` requires, and
project a `uv` onto every part, which the maps are sampled by — a model you
build some other way has neither requirement, but it does have to be a valid glb
on its own terms, and a prop that wants a map needs a `uv`. Adding a piece to a
builder page is optional and is only how you would *regenerate* it later, so a
model from another route needs no button and no entry beyond `MESH_FILES`.

### Looking at a model before shipping it

`tools/render.html?f=bush.glb` puts one model on its own at four angles, wearing
the maps its file declares; `tools/compare.html?a=meshes/rock.glb&b=tools/backup/rock.glb`
puts two side by side and gives the numbers that answer "is it the right size";
`tools/inspect.html?f=rock.glb` reports mesh names, vertex counts, bounding
boxes, attributes and maps, and audits the whole manifest at the foot;
`tools/wardrobe.html` is the wardrobe on the game's **own `headG` node** - every
face and every hat bare, or `?face=cheer` for one face against every hat, or
`?face=cheer&hat=straw` for one pair, big. All four take the maps out of
`meshes/tex/` themselves, the same way the game does, and `render.html`'s
`?maps=0` puts them back the other way. `tools/README.md` is the full reference.

**The wardrobe page wears the game's head and does not build one**, and that is the
whole of what it is for: a face is four centimetres of geometry placed against six
numbers, so a preview carrying its own copy of the head is a second place for them
to be wrong - and both builder pages already have those numbers written down beside
the code that places a hat on them. **It reports a name with no file behind it**,
which is the half of the silent failure `plan-test.mjs --faces` cannot see: that
check says the manifest and the derivation agree, and the page says whether the
bytes are there.
If the server happens not to be running, none of that is a blocker: a glb is a
binary header followed by a JSON chunk you can read with any glb inspector, and
the game itself is the real test — put the prop in a course and look at it.

**`.kilo/skills/snail-assets/SKILL.md`** is the working document for any of that:
which prop has which map, what the suffixes mean, how a uv gets onto a piece,
and what never to do. It and `meshes/maps.js` are mirrors of each other.

## Data

`races.json` is a list of courses. `len` × `scale` is the length actually laid
out; `pool` names the obstacles dealt into it, and every element named needs at
least one of each, so `feats` must be ≥ the number of distinct elements.
`run` needs nothing; `climb` needs `climb` and `climbRun`; `leap` needs `gap`
and `lip`; `water` and `leapClimb` need `gap`, `lip` and `deep`; and
`pushCrate` needs nothing, because the gap is the element's own and the crate is
put there by hand. A course that breaks this says so at boot and stops, with the
reason — the check is at `src/core.js:316` and is worth keeping in step with any
new element. `wiggle` and `corners` shape the line. `level` and `drain` are
optional.

`seasons.json` is the ladder: `lo`/`hi` the rating band, `scale` the length
scale courses run at, `races` the four rounds, `finale` the course that closes
the season.

**A cup is one course of each trait and then the marathon, and both halves are
checked at boot.** Four courses means four traits, so four rounds is the whole of
one rung, and `stamina` is not one of them — it is the bar the Grand Marathon
drains, not a course a card can name. So `core.js` asks the roster a question it
has to answer and stops with the reason: **every trait of `ATTRS` but `stamina`
exactly once, no course that names no trait, and a finale that exists, is not on
the card twice and tests nothing of its own.** This is the quietest failure the
county has: a cup with `power` twice and no `flying` in it plans four courses,
runs four races, pays a purse out of each, writes a result against every one and
prints "tests power" on two lines, with nothing anywhere saying a snail never once
got to fly. It arrived by the best route available — four tiers, one ashlands
course each, all four appended to the end of the roster, and the course nobody
looked at was the flying one. **`tools/plan-test.mjs --seasons` prints it** and
also prints, per trait, the courses of that trait in each biome, because the
ashlands round is a *swap*: it enters in place of the temperate course of the
trait it shares, which needs a course of that trait in that biome to exist in
every tier.

**And `biome` names the look of a course, and a course that names one nothing has
heard of stops the boot beside the pool check with both ids.** The field was
written on every course before anything read it, so a typo would have come up
temperate: a meadow with a dead valley's name on it and nothing saying so, because
`useBiome()`'s fallback is a plausible biome. The check is at `src/core.js` and it
is the same shape as the element check for the same reason — **a name that resolves
to nothing is a quiet answer.** The role, palette and prop checks are not there and
are `tools/plan-test.mjs --biomes` instead, because they are about the table rather
than about a course.

## Biomes

A biome answers three questions and nothing else: **which surface key is my turf,
my cliff, my shore and my track**; **which county colour is each of the sixteen**
`PAL` keys the surfaces are painted from; and **which props are standing in the
country**. Everything else about a course — its length, its obstacles, its shape,
its pool of features — is the planner's, which is why `plan.js` never reads one.
The table is `meshes/biomes.js`, beside `maps.js` and `palette.js` because **those
two carry no three.js import** and this one does not either, so the game reads it,
the four builder pages read it, and `plan-test.mjs` reads it from node. It is the
third file of that kind and `.gitignore`'s `!/meshes/biomes.js` and `check.sh`'s
graph line are the two places its right to exist is written down.

`.kilo/skills/biomes/SKILL.md` is the working document for a biome: the six steps
to add one, the four roles, the sixteen, the far country and the fog, the stable,
the arrangement table, and the seven ways a biome can be a wrong picture instead of
a broken one.

**A biome is a table and not a branch, and the reason is the registry the whole
project is written against.** There are seven set entries across three
`triplanarSets()` calls, sixteen palette keys and one prop list, so a branch at
each of those sites is twenty-four `if (biome === 'ashlands')` lines in three files,
none of which can be checked against a list — and the first one somebody forgets is
a meadow with the cliff's tile on it, which is not an error and not a crash and
looks like a decision.

**The sixteen are sixteen and not one, and naming fifteen is the quiet failure.** A
surface bakes its colour into vertex colours, so the only way an ashlands course
stops being a meadow is for the sixteen names under it to mean something else. A
fifteenth would leave the sixteenth holding whatever it had on load, which is
`temperate`'s — a plausible value with nothing wrong-looking about it — so
`useBiome()` warns on a name it cannot find and `--biomes` fails on a `pal` that
is not sixteen long. The list lives in `meshes/biomes.js` and not in `surfaces.js`
because it is a fact about the table rather than about the one module that reads it.
**And there is no green in the ash group**, which is a flag and not a comment
because a comment cannot be asked a question: a single green is a course with a
meadow in it, and the first one anybody adds is going to be deliberate.

**The seven set entries are seven and every biome has the same seven in the same
order**, because the weight a vertex gives a set is the set's *letter*. A biome
that left one out would change what the remaining weights multiply and three would
find a different program under one material name, which is the invariant the cache
key below rests on. Which role is drawn `uv: true` is a property of the **slot** and
not of the role: `track` is `uv` everywhere and `shore` is `uv` on the flank and
not on the ground, because a flank has a lane to follow and a county does not.

**A biome's gains moved out of the material block and into the table, and the move
needed a recompile to be worth anything.** `colourGain` is a GLSL string literal
rather than a uniform — it multiplies a per-set sum — so a biome cannot change one
by writing to a uniform and the honest answer is that it does not try: it builds the
program again. **And the biome's name goes into `customProgramCacheKey`**, because
that key is what stops three handing back the program it has already built. Leave it
out and `needsUpdate` recompiles `mat.course`, three finds `triplanarSets3` in its
cache, hands back **the meadow's program**, and the ashlands ground is drawn with
the meadow's grain at the meadow's gain — a wrong picture rather than a broken one,
and the same failure the `anyUv` half of that key was written against.

**Two of the four lines of `useBiome()` are there because of failures this project
has already had, and the second is the one that is easy to leave out.**
`triplanarSets()` **assigns** `onBeforeCompile` and `gfxSurface()` chains, so
running the sets again at course-build time silently throws away the cloud shade
and the wind on that material — the meadow stops leaning and the ground goes flat
under a moving light, which is not a crash and not a warning. `gfxSurface()` is
called again behind it every time, and it is a one-line omission that reads as
tidiness.

**And `gfxSurface()` is a re-chain and not a chain, because it is called again.**
It keeps what the material carried before it on `m.userData.gfxBase` and rebuilds
from that, because a second chain puts a second `varying vec3 vGfxW;` in one
shader: a redeclaration and not a warning, so the material loses its program and
draws wrong with nothing in the console but a compile error about something else.

**The standing biome is a pair and not an export, and it lives in `materials.js`
for two reasons that are not tidiness.** `PAL` is already there and so is
`triplanarSets()`, so one call writes the sixteen and rebuilds the four and nothing
else has to learn what a biome is. And a `let` written in one module and read in
another cannot be assigned from outside — `TypeError: Assignment to constant
variable`, on the first call — **and it cannot be emptied either, which is the
worse half**, so every flag a module shares comes out as a pair:
`biomeNow()`/`useBiome()` here, `clearRegister()`/`standingReport()` for the prop
register, `stageOf()`/`buildStable()` for the stable. **It is not a member of the
`world` registry**, and that is the registry's own argument: every one of its
fifteen functions is one because it reads something reassigned after boot, and a
biome is a fact about the course being built with every consumer downstream of that
one call.

**Two callers, and each says which biome it is building rather than leaving one
standing.** `buildCourse()` calls `useBiome(cat.biome)` and **`buildStable()`
calls `useBiome('temperate')`**, and the second is the one that is not obvious. The
stable's lawn and plinth are built on fresh materials with `PAL` read at build time
and **vertex colours are baked**, so a stable already standing is untouched by a
later `useBiome()` elsewhere — which is the one thing that makes it safe and also
the thing that hides the bug until somebody presses the density row, and
`restage()` rebuilds the stable, so the two are not "a race and then never again".
`biome.spec.js` presses one.

**`mat.grass` is shared and is not swapped.** It is the course tufts and the
stable's own 5,100, so a biome that swaps its turf set has a lush green meadow
rebuilt with an ash tuft's grain on the stable, in the lobby, at the plinth — and
the tell is a grey lawn the inspector does not have. So the jar **grows** rather
than mutates, the same call that made `mat.ramp` a second material instead of a
flag on `mat.road`, and a standing material nothing wears costs nothing because
`dropCourse()` disposes geometry and has never disposed a material. `mat.ashFoliage`
is on the wind list and its colour is a **dark** grey: the meadow's own arithmetic
says a tuft is a fifth of its ground, and an ash tuft brighter than the ash it
stands in is a meadow in a dead valley's clothes.

**The far country takes two jar names and not two hexes, and only the race env's
fog takes a tint.** `mat.hillNear` and `mat.hillFar` had `0xb2c8c6` and `0x8cae94`
written into the hour routine — the only course-facing colour in the county not out
of `meshes/palette.js` — and they got away with it because nothing had ever wanted a
second value for them. **And which biome it is depends on the screen**, because
those two materials are one pair shared by two backdrops and the stable's never
leaves temperate; that is `onStableScreen()` and it is the one place in the county
where "read the standing biome" is wrong unless it is qualified. The fog's is a
**multiply on `TOD.fog` for `env` alone**, so a stable rebuilt while an ashlands
course is standing is not painted the colour of a dead valley.

**A course's backdrop is rebuilt and not tinted, because a barren horizon is mostly
silhouette and a silhouette is geometry.** Two biomes are alive in one session — the
stable from boot and the Adversary's duel from the player's first race — so
`rebuildBackdrop()` disposes what it replaces and bakes again, and **that disposal
is inside that function** because `dropCourse()` is handed the *course* group and
the backdrop is a module-scope `const` that is not in it. It is the one leak the
feature opens.

**The arrangement is a table, and the order of its keys is the arrangement.**
`PLACE` in `src/scenery.js` is every prop the county knows how to scatter, in the
order they go down, and `populate()` walks it once — because whatever goes down
first is what everything after has to arrange itself around, and the giant mushrooms
have to beat the trees or a conifer a metre across is claiming its metre before a
mushroom six metres across has said anything. `Object.keys()` on string keys is
insertion order, so a temperate course's standing is the standing
`golden.spec.js` compares. A prop the biome has not named is counted in
`standingReport().declined` and not placed, **so a biome that quietly stopped
declining anything says so in a number rather than by looking the same as it always
did**, and `plan-test.mjs --biomes` prints the same pair per course.

**One table cannot express "in the middle of that", and the two half-entries around
the lantern poles are what it costs.** The arches' *positions* are drawn by an entry
above the poles and the arches themselves are placed after them, because a pole in
front of an arch hides the thing it is standing in front of. **The poles' `opts` is
a thunk for that reason and a value everywhere else**, and an options object built
when the table is built concatenates `null` instead of the arches — which is **a
number of poles and not a wrong picture**, three of the five baseline courses two
poles short, the two without water exactly right, and no error anywhere in the
county. `golden.spec.js` found it.

**And one prop is many slots, which is where the table's one real trap is.** `rock`
is two bands — the verge and a chasm floor — and a biome says `rock` once. A second
entry for a prop the biome already names runs on **every** course, draws sixty times
further down the shared `rand()` stream than it should, and takes the next prop's
keep-clear list with it. Both halves of that happened on the first cut.

**A duel is a course in `races.json`, and its `duel` object is the whole of it.**
Whichever entry carries a `duel` is the duel's course, and it holds the field's size,
the countdown, the purse, the two locked wardrobe names, their `attrBonus`, `skill`
and `greed`, the rating a win is worth, the hour it is raced at and its own length
scale. `duelCatId()` finds it and the fallback is the marathon, written down,
because a county with no duel course should still be a county that runs one. **And
it is read off the course and not off `race.duel`**, which was set in `startRace()`
and nowhere else — not in the `race` literal, and `wipeSave()` did not clear it —
so an inspector opened after a duel built a **two-crate apron on an eight-snail
road**. One answer and no second copy.

**And the hour a course is raced in is `day` or `finale` and not a boolean**, which
is a fourth thing the duel's entry fixed: the app read the tier's finale, the duel
came up in the morning, and a green-lit course with dead ground and no sun in it is
a wrong picture rather than a broken one.

## Settings

`#optbar` opens `#options`: a grid of six buttons, each a whole preset, over ten
rows that can also be set one at a time. The rows are `render` (device pixel
ratio, as a multiple of native, capped), `msaa` (`off / x2 / x4`), `scale`
(`nearest / bilinear / b-spline / mitchell / lanczos`), `distance` (fog
and the width of the ground beyond the draw distance), `shadow` (map size, radius
and whether props cast at all), `props` and `grass` (density), `sky` (dome
segments), `ssao` (occlusion, indirect light, and how many samples each step
spends) and `refl` (the per-pool cube probes and how far they look, named **Sky
probe** so it is not the other reflection row wearing the same word). Six is
the top and three is what the game shipped looking like before any of this, so
three is the default and `localStorage['snail-grand-prix-gfx-v1']` is its own key:
these are settings
for the machine, not progress, so nothing here is written into the save, no
version is bumped and `wipeSave()` leaves them alone.

**The frame's scale was the browser's and not ours, and there was no scale in the
frame for WebGL to have an opinion about.** The canvas backing store *was* the
county's resolution and the browser stretched it to the window, so whatever
filter produced that stretch was a compositor decision with no setting behind it.
So the canvas is **native** now and the county is drawn at a share of it, and the
resample that puts one onto the other is a pass we own: `presentPass`. The two
numbers are equal only at render scale 1, so `needsResample()` is the whole of what
the render row costs — at 1× the direct path is untouched, and at every other step
the county draws into a buffer and one quad puts it on the window. `scenePixels()`
is the county's resolution and `canvasRatio()` the window's, and they are not
allowed to be the same function.

**`presentPass` extends `OutputPass` and replaces one line of it.** It exists so
the kernel is somewhere a row can reach, and it inherits rather than reimplements
so that the tone map and the transfer function are three's own and cannot drift
from the ones every material in the county was compiled against. The kernel lives
above the tail; the tail is byte for byte three's, and **`void main()` opens in one
constant and closes after the other** — a fragment that closes `main()` before the
tail puts `gl_FragColor = ...` at global scope, where it is not an assignment, and
the compiler answers `gl_FragColor : syntax error` at a tone-map line with every
line above it correct. That is the shape of the mistake: nothing near the message
is wrong.

**A resampling filter's DC gain is one, or choosing it changes the exposure rather
than the reconstruction.** The taps are explicit and at texel centres rather than
left to the sampler, which costs four fetches for bilinear where the hardware would
do one and buys the only thing the row needs: the answer cannot be changed by
something else's filter state, and `minFilter` is a property of the *texture*,
which is the bloom's input and the occlusion's too. Keys' bicubic at a = −0.5 has a
negative lobe and sums to **1.0625** at half phase, so a flat region came back 6%
hot until the weights were divided by their sum — **and the divisor is the product
of the two one-dimensional sums and not the sum of the products**, which is the
diagonal and goes to zero at some phases. The tell in all three cases is the mean,
not the picture: the frame reads as *bright* rather than as *wrong*.

**The outer segment of a bicubic kernel is a whole polynomial.** Written
`0.5(-x³ + 5x² − 8x + 4)` it reaches zero at both ends of its span; written
`−0.5x³ + 2.5x² − 1`, which is what you get from copying the inner segment and
changing the leading sign, it is 1.0 where it should be 0.0, the four weights come
to about five between them, and the frame comes back **2.5 times too bright** on
every pixel without overflowing anything. Keys' a = −0.5 and not a cubic B-spline
because the sharper of the two is what a racing frame wants, and not a Lanczos
window because that rings on exactly the hard silhouette edge a racing scene is
made of — for the same sixteen fetches.

Measured on a course stood still, hard-edge pixels over six levels apart, which is
where a kernel can be seen at all:

| | nearest | bilinear | bicubic |
|---|---|---|---|
| county at 0.5× (2× upscale) | 2,027 | **605** | 2,832 |
| county at 1× (no resample) | 3,758 | 3,756 | 3,757 |
| county at 2× (2× downscale) | 23,877 | **3,522** | 6,047 |

The middle row is the honest one: at 1× there is no resample, all three kernels
are the identity, and the caption says so — `4 fetches · idle at 1×`. Bilinear is
the smoothest on the upscale and nearest the worst on the downscale, which is
exactly what the two operations are; bicubic sharpens, which is what Keys' a = −0.5
is for, and the frame means across the three sit within 0.1 of 255.

**The render scale is the one row the preset does not own, and it is named in
multipliers rather than in steps.** A preset is a claim about what the machine can
afford; how many device pixels a pixel of the window is worth is a claim about the
panel it is on. So the row carries `own: false` and a cascade writing *N* into it
would override a player who set theirs to 1× on a retina display because they
changed something else — and the fix for a machine that cannot pay for a supersampled
frame is the row above the preset, not the answer being decided for them. The
cells are `0.5× 0.75× 1× 1.25× 1.5× 2×`, **generated from `RENDER_SCALE` rather
than written beside it**, and each one is a claim that can be checked: on a 960×600
window at `devicePixelRatio` 1 they are 480×300, 720×450, 960×600, 1200×750,
1440×900 and 1920×1200. Six labels that disagree with the six numbers they name is
a menu lying about the thing it is setting, and the caption beside the row is
showing the answer anyway — `1.00× · native` at the middle and `1.50× device` at
the fifth, because the cell is a share of native and the caption is the device
pixels it lands on, which are different numbers on different screens.

**A row the preset does not write is not a row the preset cannot be recognised
for, and the level is read off a row that carries no table.** `gfxLevelRow()` is
the first row the preset owns *and* writes by identity, and both halves of that
are load-bearing. `GFX_KEYS[0]` reads the machine's tier off a player's screen, so
a machine at Balanced with a 0.75× render scale came back `mixed` — the one answer
the panel gives for a machine that disagrees with itself, which is not what
happened. Taking the first row the preset *does* own is the same bug one row out,
because the anti-aliasing row owns itself and brings a table with it: it holds 1 at
Balanced, and a level of 1 asks the whole menu to be Low. Only a row written by
identity holds the level, so that is the one that is read. `setDefaults()` is the
same two ideas again — the button at the foot says every row, so it puts the row
the preset does not own back to the middle of itself (`Math.ceil(steps / 2)`, which
is three of six and two of three) rather than quietly leaving it alone.

**Anti-aliasing is the context on one path and a render target on the other, and
the row only names the second.** The renderer is built with `antialias: true`,
which was `false` and looked for a long time like a step backwards. A context's
multisampled default framebuffer is free — which is why it was on in the first
place — and it is the only smoothing a frame drawn straight to the window can
have, so the direct path has it back. **It is a context-creation parameter, so no
row can change it and a change to `msaa` does not reach it until the page is
reloaded.** It is also a boolean and not a sample count: `getContext` has no way
to ask the driver for two of anything, it takes a boolean and the driver picks
the count, four on most of them. **So the bottom cell is `direct only` and not
`off`** — zero is what the *composer buffer* is built at, and the buffer is not
the only place a pixel can be smoothed, so `off` was a word about the buffer
wearing a claim about the frame.

**And the two counts are not the same number, which is the wart this leaves.**
On a driver that gave the context four, `x2` on the composer path is *less*
smoothed than `direct only` on the direct path. That is inherent rather than a
mistake in the wiring — the context's count is not a parameter anybody passes,
and WebGL exposes no call that asks for it — so the response is the caption and
the row's name rather than a second mechanism pretending to reconcile them.
`gfxCaption()` says `context MSAA · no buffer` on the bottom cell and `idle, no
chain` above it, and **the one thing the menu may not do is quote the row's
ladder for the context**, because the game does not control that number.

**MSAA on the composer path is a render target, and it no longer builds one on
its own.** `needsComposer()` reads `ssao >= 2 || fxBloom > 0 || gfxSsrOn() ||
needsResample()` — four terms, `gfxMsaa() > 0` was the fourth until the context
took the direct path's smoothing back, and `gfxSsrOn()` is the fifth. A machine that asks for x4 with the occlusion off
and the render scale at 1× gets **no chain at all**: the count names a buffer the
frame never has, which is a row claiming a cost nobody is paying and is the one
failure the change invites. So `syncComposer()`'s idempotence guard only compares
`msaaKey` while the chain is wanted — it is `-1` with nothing standing, and
comparing a live count against the absence of one is a guard that is not guarding.

**A sample count is baked into a framebuffer when that framebuffer is built, and
never afterwards.** So the count is not a uniform and there is no way to re-sample
a target that exists: `msaaKey` sits beside `composerUp` rather than inside it,
because the two cross independently — a count can change while the chain stays
wanted — and `syncComposer()` tears the chain down and builds it again when it
does. `WebGLRenderTarget.setSize()` disposes a target whose size moved, so the
framebuffer is rebuilt from `samples` and **the count survives the render-scale
row**, which is the one that resizes it. `RenderTarget.copy()` carries `samples`
across, so both halves of the ping-pong are multisampled and whichever one
`RenderPass` writes is the one that is.

**Three states and not six, so the row brings a table of its own.** `MSAA_PRESET`
is `[1, 1, 1, 2, 3, 3]` — `direct only` at the bottom three, x2 at High, x4 at
the top two — because three states cannot hold six numbers, and a cascade writing
*N* into the row would put a step it has no cell for on it and a cell it cannot
reach in the table. `gfxRowValue()` is the one function that answers "what does
this row hold at level *N*", used by both the write and the test, because **a row
whose write and whose test disagree is a preset that can never be recognised as
itself**: Balanced would write msaa 1, and reading `mixed` back for want of a row
nobody compared. Balanced is `direct only`, which is the picture the composer path
has always drawn. `MSAA_SHORT` beside it is the perf panel's answer rather than
the modal's, because that panel's value column is 3.4em on the grounds that the
widest thing in it is five characters.

**A cell that builds a post chain says so on the cell, and it is drawn before
anything is pressed.** `CHAIN_CELLS` is the terms of `needsComposer()` that are
decidable from their own row alone, asked of a *cell* rather than of the row's
current value, and every marked button wears a two-pixel orange frame for as long
as the panel is open.
The frame was on the row first, which is the wrong end of it: a row frame answers
"is the chain up now", a question that is a step behind the player and can only be
read after they have pressed something, while a button frame answers "what will
this cost me", which is the question they were asking when they looked. **The
cells that carry no frame are the ones worth being sure about** — `1×` on the
render scale, cell 1 on the occlusion, `off` on the bloom — and a frame round a row
that sat at `1×` would have been the border lying about the cheap option.

**And it is not "would the chain be up if I picked this", which is a different
question and a worse one.** That answer moves as the other rows move — bloom on
and `1×` stops being free — so the same button would gain and lose its frame for
reasons the player never touched, and **a border that flickers on an unrelated row
is not a cost, it is noise.** So each cell is asked about its own row alone, the
frames are set when the panel is built, and `syncOptions()` leaves them alone: a
button that changed shape when you pressed it would be telling you about the past.

**The tell that the tone map is still applied once.** The direct path's ACES is in
the material shaders and the chain's is in `presentPass`, and a multisample resolve
moves from one to the other the moment the row leaves `off`. So: mean
luminance of the frame **94.66 at off and 94.85 at x4**, 0.2 of 255, against a
count that came out wrong in either direction moving the mean by tens. The edge
numbers off the same two frames are mean absolute horizontal gradient **2.864 at
off, 1.207 at x2, 1.200 at x4**, and hard-edge pixels — those over six levels
apart — **13,056 → 1,906**, which is the jaggies becoming ramps. **One cell per
drawing-buffer texel or none of it means anything**: a grab at the window's size
against a buffer at a 0.5 render scale reads each texel twice and every gradient
comes out at exactly zero.

**The effects were a six-step stack and are now seven switches, and a stack is a
bundle.** The `fx` row turned on everything up to its level, and the order it
stacked them in is the order of what they cost — a fullscreen quad, a uniform, a
composer pass — so the row was defensible as a ladder and was useless as a menu:
a player who wanted the cloud shade and not the film grain had no cell to press,
and the only route to that picture was to edit `localStorage` by hand. So the
stack survives as what it was always good for, `FX_PRESET`, the set a preset
writes, and `FX_TOGGLES` is the menu: glow, vignette, grain, cloud shade, screen
reflections, bloom, wind, one switch each, with the row's own cost in the caption
where a ladder row has the level's description. **A preset is still a full
write**, so pressing `Balanced` puts a grain you had just switched on back off —
the same thing it always did to the other rows, and the reason a preset is never a
partial change and never strands a player in a picture they cannot get back to. The
bloom row has three cells, `off / bloom / bloom hi`, because that is one effect at
two strengths and not two effects, and the ladder had both.

**The reflections row is an fx switch and not a seventh ladder row, and that is a
shape decision rather than a preference.** `setToggle`'s 0-based clamp is the
right clamp here and `setRow`'s 1-based one would put a 1 on the row's *second*
cell; `gfxLoad`'s fx loop validates against `cells.length` and an old save with no
`fxSsr` keeps the default, so there is no migration and no version bump; and
`setPreset` writes `want[r.key] || 0`, which makes `FX_PRESET` the only place the
rung is decided at all. The landmine it walks around is `gfxLevelRow()`, which
reads the first owned row carrying no table out of `GFX_ROWS` — a new *ladder* row
inserted before `distance` would become the level row and every preset would come
back `mixed`. **The row is named for the mechanism and not for today's users of
it**, because "water reflections" would be a row lying the moment a surface
outside the list carried a mark, and a shell carrying one is a single line at its
plant site.

**A traced reflection needs a depth buffer to trace, so its gate is two rows and
not one.** `gfxSsrOn()` is `ssao >= 2 && gfx.fxSsr > 0` and it is derived once in
`post.js`, asked by `needsComposer()` and `syncPasses()` and by nothing else. The
cost of the dependency is that **`fxSsr: 1` with the occlusion off is armed and
inert**: the switch reads on, the chain is not built, and there is no picture to
show. That is disclosed in the row's `cost` and in its tooltip rather than papered
over, and it is the trade the dependency buys — it replaces a silently wrong
reflection with a stated restriction.

**And which surfaces can be traced is a stamp on geometry and not a material
list.** `reflectMark(geometry, f0, kind)` writes one float per vertex; the sign of
the float is a flag. **A negative mark is a surface this pass has no normal for in
the G-buffer** — the water, which is `transparent` and writes no depth and is
hidden out of that buffer on purpose — and it takes the world's up instead. The
default is **zero**, which is the one number that decides whether this is a
reflection or a county made of mirrors, and it is measured: on a course with no
water in it, the march on changes **zero pixels** of a 96×54 readback. The
alternative to the attribute was a list of material names, and a list that goes
quiet the day something is not on it is a pool that stopped reflecting with the
switch still lit.

**And the number is a reflectance and not a strength, which is the whole difference
between a reflection and a mirror.** A dielectric reflects two to four per cent
head-on, so a mark that meant "one, and reflect all of it" on a painted crate would
be a lie the Fresnel term then undoes — the shader had water's own `F0` as a
uniform, so every surface in the county reflected like a pool and nothing else
reflected at all. **`f0` in the mark and no Fresnel uniform in the pass** puts the
number where it belongs, one per surface, and **water's is 0.02 because that is the
index of 1.33**. A metal's albedo is the same number, so a mirror is a mirror in
its material too rather than a shiny thing with a flag on it.

**And the first thing that wore one is a cube on the stable, which is a test object
and says so.** `mirrorCube()` in `stage.js`, `PAL.mirrorFace`, 0.92 — **a flat
surface is where a traced reflection is at its most legible**, because it shows one
flat answer, the world mirrored sharply, where a curve shows a smeared version of
the same thing a reader has to know is the same thing. It is also the only place the
frame loop can be held still enough to measure the effect on, and the only thing
that takes the `m > 0` branch of the mark's sign.

**So the row carries its cost in the caption and the course-dependent half in the
tooltip**, and that is the general addition: a switch's caption is `row.cost`, a
property of the row and not of where it is set, so "a composer pass" says nothing
about whether anything in the county can be reflected. `row.live` threads
`gfxCaption()` into `optRow()`'s tooltip only, and it is off on every other row so
it cannot become a second place a caption is decided. `reflectReport()` is the
sentence — `pools`, `cube`, `pools, shells`, `no water on this course` — and it
walks **`world.renderScene()`** rather than keeping a register of what has been
built, because the lobby and a course both stand at once and only one of them is
drawn: a register is either emptied below the thing that fills it or true of one
screen and about the other, and both of those shipped. The tooltip and
`__snail.reflect()` cannot disagree.

**The march is a composer pass and not a filter, and it is deliberately not
framed.** `CHAIN_CELLS` carries a frame on every term of `needsComposer()` that
is decidable from its own row alone, and this one is not: `gfxSsrOn()`'s two rows
cross, so a frame on either cell would appear and vanish as the occlusion row moved
— for reasons the player never touched, which is the noise the list exists to rule
out. Its cost lives in the caption and the tooltip instead, and the invariant is
written down at the list: **a term that is decidable from its own row carries a
frame; a term that is not carries its cost in its tooltip.**

**And the thickness test is after the bisection and not in the march loop, because
before it every overshoot was a miss.** The coarse walk steps metres — 42 m over
eight steps — so the first sample past a surface lands the ray *inside* what it
crossed: a mirror four metres off the camera has the lawn at eight and the sample
at 5.25 puts the point two and a half metres under it. The first version tested
that penetration against `uThick` **in the loop**, read a genuine crossing as too
far behind to be real, and gave up, and **the cube came up flat white with a few
slivers of reflection wherever the geometry happened to be close enough**. The
bisection is what resolves an overshoot and it cannot do its job on an interval it
is never handed, so the loop's test is a positive penetration and nothing else, and
`uThick` now means *four steps could not resolve this crossing* — which is the only
thing a thickness can say once the refinement is there to be measured against.

**And the occlusion ladder lost its resolution axis, which is what the gate made
necessary rather than what the march wanted.** `AO_LADDER` used to be a 2×2 —
resolution on one side of it, indirect light on the other — and its half-res cells
are gone: **a reflected ray marched against half-res depth breaks against
silhouettes**, and on a pool the silhouette that matters is the shoreline. The
samples had to be re-spread with them, because deleting the flag alone would have
left steps 3 and 4 structurally identical and `ssao: 4` and `ssao: 5` drawing the
same frame on two buttons. Steps 3 and 5 are byte-identical to what they were;
step 4 drops to four samples and step 2 gets about four times dearer, which is the
accepted price of *every AO cell being a valid SSR host* — `ssao: 1` is off and is
the answer for a machine that cannot pay it. `sizeGtao()` and `sizeGtaoGi()` were
two readers of one field and are now `sizeGbuffers()` reading nothing at all, and
the first structural regression test in the suite asks each target for its own
size at every cell.

**The bounce and the march want opposite things out of the same walk, and that is
why there are two flat buffers and not one.** Both are a whole scene through one
override material — `MeshBasicMaterial` with the vertex colours and nothing else,
so the colour a piece writes is the flat base colour baked into its geometry. The
bounce reads the `.rgb` of one and the march reads the `.a` of the other, and they
want different hide-sets: the bounce is an estimate of what the *ground* can see,
so the water has to be out of it, while the march needs the water *in*, or the ray
it starts on a pool starts on the pool's floor and reflects about the floor's
slope — which leans away from the viewer at every bank. Sharing one buffer would
mean the bounce reading a pool's own colour where it used to read the sand under
it, **on every machine whether or not a reflection was switched on**, and a
feature that changes the picture when it is off is not off.

**So it is two renders, and the second only happens when a reflection is
standing.** The mark rides the alpha, which is free — the *beauty* buffer's alpha
is not, because `GTAOPass`'s `blendMaterial` is `CustomBlending` with
`blendSrcAlpha: DstAlphaFactor` and `blendDstAlpha: ZeroFactor`, so destination
alpha is squared every frame the pass runs. The clear alpha is **zero** and that
is the one behavioural thing about the render: a pixel nothing was drawn into has
to read *nothing is reflecting*, and the renderer's clear alpha is one.

**And the mask's depth attachment is sized by hand, because
`WebGLRenderTarget.setSize()` does not do it.** It resizes the target's *colour*
textures and its viewport, and leaves an attached `depthTexture` at the size it was
built at — and the county builds it at 1×1, before it knows how big the county is.
`sizeDepth()` resizes the two together, and **the failure is the quietest in this
file**: the framebuffer is complete, the colour is right, the depth is a depth
texture of the wrong size being sampled, and nothing anywhere is red. The march
reconstructs every marked pixel's origin from it, so every ray started at the
near plane — **and the result was the water drawn over the bank it sits below**,
which is what a player sees and what no assertion was asking about. A target's
depth attachment is a buffer of its own with a size of its own, and it is not
`setSize()`'s job.

**Film grain and a vignette are off on a fresh install and on every preset**, so
they are the two switches with no rung on the ladder at all. A grain is a filter
laid over the picture and a vignette is a dimmed one, and neither is a thing the
county looks better for being given by default. They share one fullscreen quad
and `drawOverlay()` bails when both are off, so with them off the bottom tier pays
nothing for having them. The tell, if it ever comes back, is two frames of a
course standing still on the inspector that are byte-identical with the grain on:
on a still course the two are the same picture, and with the grain on they are not
— **0.000 of mean absolute change per pixel off and 2.18 of 255 on**, which is
the grain's own amplitude and not the readback's.

**The one migration is off the row the six replaced, and it is the same key.**
A machine that saved a level under the stack carries an integer `fx` and none of
the six, and the honest reading of that is the picture it chose and not the
default it never asked for, so `FX_LEGACY` re-expands the level at the thresholds
it had. Grain and the vignette come across switched on for the levels that had
them, because that is what those levels were.

**A target handed to `EffectComposer` is sized in CSS pixels, and getting that
wrong is invisible at 1×.** It reads its width and height off the target it is
handed and multiplies them by its own pixel ratio inside `setSize()`, so a target
sized in *device* pixels has the ratio applied to it a second time — which reads
correctly at 1× because the ratio is one, and renders the county at **a quarter of
the pixels asked for** when a machine boots straight into 0.5×, because then the
ratio is not one to begin with. 240×150 of chain behind a 480×300 canvas is the
tell.

**The bottom tier is the game's own `renderer.render()` and stays that way.** A
tier asks for the composer with `needsComposer()` — `ssao >= 2 || fxBloom > 0 ||
gfxSsrOn() || needsResample()` —
and `composerUp` is only ever true across that boundary, so a machine at tier 1
spends no render targets and gets no pass. The grain is on the far side of that
line deliberately: it is a fullscreen quad and not a chain, so switching it on at
the bottom tier leaves `passes` empty and the target count where it was. That is
the regression gate, and it is
worth running rather than assuming: `window.__snail.info()` reports the pass
names and `renderer.info.memory.textures`, and `window.__snail.grab()` reads the
last frame back as numbers, so `grab()` either side of a tier change is the two
paths measured rather than photographed. Read the two as the *same* picture
barred occlusion — the numbers to expect are a mean of about 2.7 of 255 and a
signed mean of +0.3, the direct image being marginally brighter in the creases
GTAO darkens. Two captures of the *same* path seconds apart differ by more than
that, because the sun moves on the stable, so a photograph taken the way a
screenshot is taken answers the wrong question.

**A pass's own setting can be null while the pass is still standing.** One call to
`applyGraphics()` applies in an order, and the order is what makes it so: the
pixel ratio goes on first and `applyRenderScale()` resizes whatever is in the
chain, and the tier that *removes* a pass goes on last, in `syncComposer()`. So a
change that switches the occlusion off reaches `sizeGtao()` with the old
`GTAOPass` still standing and a `null` on the row, and `gfxSsao().half` on a null
is the crash a player gets for choosing the bottom preset off a composer tier —
which is a row that was never the subject of the change that found it. Both
`sizeGtao()` and `tuneGtao()` therefore ask the **ladder** and not the pass, which
is the general form of it: **the value that decides whether a resource is wanted
is the setting, and the resource standing there is evidence about the past.**

**The readout is one panel shown by `mode`, and it says which window every number
came off.** `#perf` is not inside `#hud` or `#inspect` on purpose: a race and the
inspector are the two modes where the frame cost is the thing being judged, and a
panel driven off `mode` has no fourth call site to forget. The frame time is the
**raw gap between rAF callbacks and not the loop's own `dt`**, because `dt` is
clamped to 50 ms so a long frame cannot teleport a snail through a wall, and a
clamped `dt` reports a stutter as exactly 20 fps — a floor, and the one number a
performance readout must never invent. The average comes off **every frame since
the mode was entered** and the two low numbers off a **300-frame ring**: an
average over a whole race answers "was this smooth" and a 1% low over the last
three seconds answers "is it hitching now", and a 1% low over the whole race
stops moving after the first hitch, which is a number that has stopped being a
warning. The two windows disagree in the direction that looks like a fault —
three seconds into an inspection the average is still carrying the course build's
long frames, so the panel printed an `avg` of 110 under a `min` of 118 — so the
foot says which is which rather than leaving a reader to decide one of them is
broken. **A "1% low" is counted back from the slow end of the sort, not read off
the front of it**: an ascending sort puts the *quickest* frame at index zero, so a
percentile taken from the front returned the wrong end of the distribution
entirely — on 125 frames `1%` by that route lands on index 1, the second
**quickest**, and the panel printed a low of 60 beside a current 48, which is a
stutter detector reporting better than the frame rate it was sitting in.
`perfSlowest()` takes a count of how many frames may be slower rather than a
percentage, because one per cent of a ring that is not full is a lie about the
window: on forty frames the honest answer is the slowest of them. The ring is
sorted once per paint and four paints a second, since a panel that rewrote
sixteen cells every frame is a layout the readout would then be measuring.

**The counters are whole-frame and the reset goes above the probe pump.**
`info.autoReset` is off and the loop resets once a frame, because a frame is not
one `render()` call — on the composer path it is five or six, and with the default
reset on the count the loop ends holding is whichever pass ran last, which is a
blur pass of two triangles. The reset sits **above** `pumpProbes()` and not below
it: a probe is six scene renders and a PMREM, so a reset written under the pump
quietly drops every probe frame out of the frame's own count, and a probe frame is
the one frame in 260 where the county is doing the most work.

**The grid's two label columns are `minmax(0, 1fr)` and not `1fr`.** A `1fr` is
`minmax(auto, 1fr)`, so a label with `white-space: nowrap` is also a label the
column cannot shrink below — `geometries` is 64px of text against 59px of column
and it walked out sideways over the value beside it, which is the general form of
it: **in a fixed-width panel, anything that will not break is a minimum width, and
the minimum is not the width.** Both value columns are the same 3.4em for the same
reason, since the widest value in the panel is five characters and every pixel a
value column takes is a pixel one of the two label columns does not.

**Tone mapping happens once, and the dome is the reason there is a correction.**
three does not tone map into a render target at all — `WebGLRenderer` reads
`_currentRenderTarget === null` before it compiles a tone mapping step into a
program — so the chain's `presentPass` is the only ACES in it while the direct
path's is in the material shader; both are one application and the two paths
agree to within AO. The dome is the exception and it was already the
exception: `matSky.toneMapped` is false, so the direct path leaves it alone and
the composer path does not, and ACES takes a mid-morning sky down by about half
in linear terms — a black sky at a low sun, and pools that reflect it.

`domeToneFix()` is the correction, and **it is on the value and only on the
value.** Three's ACES is two matrices round a rational fit, and the matrices are
the identity on a neutral colour — each one's columns sum to one, which is the
whole of what a colour space round trip is — so the grey component collapses to
that fit alone and the answer is one positive scalar per vertex, bisected.
Inverting it per channel does not work and did not: ACES's image is smaller than
its input gamut, the input matrices carry about −0.5 of negative off-diagonal, a
saturated dawn orange has no pre-image at all, and the iteration looking for one
walks off into negative components and comes back as a magenta band with a cyan
one under it — which the pools then reflect, so the water goes purple. What is
left over is ACES's desaturation, the sky on the composer path a little greyer
than the same sky on the direct one, and that is the price of not painting a sky
out of gamut. The correction is repainted whenever the path or the hour changes,
and the change requeues the probes in the same breath, because a pool reflecting
a sky that has just changed colour is the same disagreement. Anything else that
opts out of tone mapping needs the same treatment, and the same repaint.

**An occlusion buffer takes opaque geometry and nothing else.**
`GTAOPass.overrideVisibility()` hides Points and Lines and stops there, so
`hideFromGBuffer()` — wrapped behind it — hides everything that cannot occlude:
the dome, which does not write depth; the backdrop's clouds and hills, which are
painted background; and every **additive glow sprite**, which the override
material would otherwise rasterise as a slab of geometry, which is not a halo
but a dark camera-facing rectangle punched through the picture. Two things about
that wrapper are load-bearing. It is scoped to **the scene the pass is about to
render**, because `restoreVisibility()` walks the same one and the county has two
of everything — hiding both scenes' share left whichever one the pass was *not*
building its buffer from switched off for good, and the stable came up with no
sky at all. And `gtaoPass.scene` is written **every frame** beside
`renderPass.scene`, because it was written once at construction while the beauty
pass was already right, which put the stable's depth buffer full of a course
nobody could see.

**Every glow tests depth, including the sixteen lamp ones, and each lamp's is
pushed toward the eye to pay for it.** Both halves are load-bearing and it was
`false` on the lamps before. A lamp glow that does not test depth is a light that
shines through the county: a lantern behind the half-way tower painted its halo
over the tower's trunk, and one behind a rock face on Crag Ascent painted its halo
over the rock. Testing depth alone is not enough either, and that is the half that
is easy to get wrong — **a sprite sits at one depth, the depth of its own
centre**, because it is a camera-facing quad, so its centre is the lamp's glass,
the quad and the glass are at the same depth, and the lamp hides behind its own
light. Hence `GLOW_CLEAR`: `syncGlow()` pushes the glow along the view axis by
0.34 m — deeper than a lantern is wide and a hand's breadth from a rock face.
Because a camera-facing quad moved along the view axis does not move **on screen**,
only in depth, the push costs nothing: no halo visibly detaches from its lamp.

**A lamp's light goes in the glass, and the glass's own bounds say where that is.**
`placeLamps()` and `scatter()` both take the head off the glass geometry and run it
through the instance matrix; no lamp position is written down. The numbers say why,
and they are not small: `lamp-post`'s arm reaches to `x = -0.567` and its glass
hangs at the end of it, and the light was at `(0, 2.36, 0)` — the right height and
**42 centimetres inboard, on the post**, with the lamp head beside it dark.
`lantern-pole`'s glass is **2.33 m out** along its arm and its light was on the
pole. Two things come off reading the number off the model rather than typing it:
the light follows the **instance's own scale**, which is 0.92 to 1.12 and was never
applied to a hand-written offset, and the number cannot go stale — rebuild the glb
with a longer arm and the light is in the glass again with no line of
`src/scenery.js` changed. `lampY` is gone for the same reason.

**A glow wears its light's colour, read off the light.** `opts.lamps` hands back
whatever colour a piece is painted in and `mat.paper` is emissive in that colour,
so a green lantern gives out green light — and the halo was `LAMP_COLOUR` for all
sixteen, a warm cream painted over a mint one and read as a second, wrong light
inside the first. `syncGlow()` copies it **every frame**, because the sixteen
lights are bound to lamps as the eye moves and a glow that kept the colour of the
lamp it was on a moment ago is a glow on the wrong lamp.

**A glow is a light, so it asks the light and not the hour.** The visibility it
checks is the *light's own*, and that is the whole difference: `syncGlow()` used
to ask `gfx.fxGlow` and `TOD.lamps` and stop there, so a slot holding no lamp
still painted a halo — at whatever place that slot last had a lamp, in whatever
colour that lamp was. On the stable, where `lampPosts` is empty and not one of
the sixteen has ever had a lamp, **that was sixteen additive halos stacked on the
world origin at a dark hour**, over the middle of the plinth, with nothing behind
any of them; and a course you walked showed a halo for the frame after a lamp lost
its light, in the colour of the lamp it used to be. **The tell is a glow with no
light in it.**

**A light belongs to a lamp and not to a slot, and the sixteen are a budget and
not a ranking.** `litLamps()` hands a light to a lamp when the eye comes inside
`LAMP_ON` (34 m) and only takes it back once the eye is past `LAMP_OFF` (48 m),
and the slot a lamp is given is written on the lamp's own record and never
revisited. Before that it sorted the course's lamps by distance from the eye and
handed the nearest sixteen to `env.lamps[0..15]` **by rank**, so the light on a
lamp was a property of the camera's neighbourhood: the frame the eye crossed the
perpendicular bisector between two posts, the two swapped slots, each took the
other's glass **and the other's colour**. Measured on Hedgerow Dash by walking six
metres in centimetre steps — **three handoffs in six metres, every one of them a
swap of two adjacent slots, every swap a different colour** (`#f7d7a4` to
`#ffd9a0`, and a mint `#a8e0cf` lantern beside a cream post) — and **98 slot
teleports** on the two circles `tools/e2e/` now walks, the lamp at `(0, -999, 0)`
among them.

**A sort with no tie-break on a quantity two lamps are equal in is not a near-tie;
it is a coin toss every time the eye moves at all** — and `placeLamps()`
alternates the posts from one side of the lane to the other, so the bisectors are
the places the eye passes most. The order is settled by distance and then by `x`
and then by `z` for the same reason: a choice made by position is the same choice
every frame rather than whichever way the sort fell.

**The dead band between the two radii is the fix, and it wants to be wide enough
to walk a lamp's own `reach` in and not cross it.** `LAMP_ON` is further out than
any lamp's `reach` so the pool is in the county before the light is on, and
`LAMP_OFF` is fourteen metres past it, so a lamp has to be pushed a long way from
the eye before its light goes. **A lamp arriving and a lamp leaving are 14 m of
lane apart, which is two to three lamp spacings**, so the ring of lamps inside the
band is what the buffer is made of — and on Grand Marathon, with fifty lamps and
sixteen slots, all sixteen are bound for **137 samples of 201 walked down the
lane**, with a lamp inside 20 m lit at every one of them. The budget saturates
without starving, which is the number worth having: a saturated budget that
starves is the old bug wearing a new hat.

**The intensity has no camera term in it at all**, and losing that one is the
other half. It was `power * clamp(1 - distance-from-eye / 34, 0.15, 1)`, so a
lamp's pool brightened as you walked towards it — and three was already doing the
physical falloff (`decay` and a `reach` cutoff) on the same lamp. Two falloffs,
one of them imaginary: the nearest lamp got roughly full power and everything past
thirty metres was squashed onto the `0.15` floor, so the sixteen lit the county
almost equally from wherever you happened to be standing.

**And the always-dark spare is gone**, because with the binding *held* a spare is
worse than useless. It was one more record at `(0, -999, 0)` so the nearest-sixteen
could never come up short, ranked by horizontal distance like every other lamp —
and the ranking cannot see the nine hundred and ninety-nine metres, so a course
coming near the world origin gave a real light slot to a lamp a kilometre under
the county, measured at intensity 1.67 ranked third nearest from the start line. A
slot that has taken it would have **kept** it for as long as you stood there, and
no lamp near the origin would ever have had a light. It also pushed `o.position`
itself rather than a copy, so the record's place was the scatter's own scratch
vector.

**`litLamps()` is in the frame loop and not in `updateTimeOfDay()`, and it is one
copy rather than the two there were.** The block was written twice — once per
screen, over the snail and over `freeCam` — so a course you walked lit differently
from the same course you raced, which is the failure that reads. And the hour is
not what decides a lamp's light: `updateTimeOfDay()` returns early when the hour
has not moved, so a stateful binding behind that guard stands frozen for as long
as the hour does, which during a countdown it does and on the stable it does.
**The value that decides whether a resource is wanted is the setting, and the
resource standing there is evidence about the past**: here the value is the eye.
A course carries **13 lamps on Crag Ascent and 50 on Grand Marathon**, which is the
spread `LAMP_ON` and `LAMP_OFF` are read against.

**And a light's `visible` is not whether it is lit, it is whether it is in the
render state's light list — and that list is what every program in the county is
compiled against.** The binding was written in terms of `lamps[i].visible`, which
reads as "does this slot hold a lamp" and is not that at all: three keeps a light
with `visible === false` out of the light list, the list is what `NUM_POINT_LIGHTS`
is written out of, and so **every lamp that took one of the sixteen and gave it
back took every material in the county through a fresh program.** Measured on
Grand Marathon by walking the inspector down the lane in 40 cm steps: **19 of 120
frames compiled anything at all, 522 compiles in 120 frames, and all 19 were frames
the visible count had moved on** — and on this machine's own renderer **ten frames
out of 250 walked cost 682 to 710 ms each**, with the frame average over that walk
going **from 8.3 ms to 33.2 ms** and back when the count stopped moving. Which is
the same sentence the render scale row is written against: **a count that decides
what gets compiled may not be a count the camera moves.** So the sixteen are in the
scene from `makeEnv()` and are never taken out, and the two halves of "off" are
`env.lampOn` for the binding and `intensity` for the light — `litLamps()` moves the
glass and writes the hour, and the hour is the only thing that darkens a lamp.

**The stable's bank is the other half, and it is `makeEnv(34, 150, false)`.** The
third argument is whether this env's lamp slots can ever take a lamp, and the stable
answers no — `lampPosts` is the course's register and there is no course there — so
its sixteen lights are dark from the moment they are made and never enter its light
list at all, which is `NUM_POINT_LIGHTS 0` on every surface of the lobby rather than
sixteen lights nothing can bind to. **A scene pays for the lights it can be handed
and not for the ones it cannot**, and the flag is written out at both call sites
rather than defaulted, because a parameter whose default decides what gets compiled
is a quiet answer to a question nobody asked.

**And a lamp stands on the ground and not on the lane's own level, which is the
same sentence twice.** `placeLamps()` put every lamp in the walk down at `sm.y`,
and `sm.y` is the height of the **middle of the lane** and not the height of the
verge two metres out from it; the two are the same number only where the ground is
flat, and the ground is not flat anywhere in this county. Measured round the four
courses at the four offsets the walk actually uses, the difference has a **median
of 30 to 60 millimetres and a worst of 630**, and on Lily Deep the 95th
percentile *is* the worst — a pool's berm puts the verge half a metre above the
water while the lane runs along the bottom of it. So a lamp post stood with its
foot 63 cm in the air over a pond, and a paper lantern on a pole with 63 cm of its
pole underground was a lantern growing out of a bank.

It is `groundYAt(fr, d)` now, the same function the surfaces are built off, so a
lamp stands on the ground that is *drawn* where it is rather than on a number that
happens to be near it. **It is asked per lamp and not once per station**, because
the three kinds in the walk stand at three different offsets — `w + 0.9` and
`+ 1.9` for a post, `w + 0.7` and `+ 1.6` for the two lanterns — and on a berm the
answer moves twenty centimetres across that half metre. It also meant going
through `trackAt()` rather than indexing `tr.sm`, which is not a detail: the two
are different shapes, and **`groundYAt()` reads `fr.x` and `fr.z`**, which is a
sample's scalar lane position and not the `Vector3` a sample's `p` holds.

**A course rebuild is caught by counting each side.** `startRace()` empties
`lampPosts` and builds it again, so a new course's records arrive with no `slot`
while the sixteen lights are still standing where the last course put them, and a
binding that only ever *adds* lights the new course with the old course's lamps —
which nothing else can see, because a stale light is a light in the right place
with a plausible intensity in it. So the guard is one number against one number,
counted after the release pass so the two are comparable, and they can only differ
when one belongs to a course no longer standing.

**And the always-dark spare at the bottom of that list is gone, because the
comment saying it was gone was written and the two lines were not deleted.** It
used to be one more record at `(0, -999, 0)` so the nearest-sixteen sort could
never come up short, and it was still being pushed beside a paragraph explaining
that it had been removed. It was live: **slot 7 on Hedgerow Dash, on, with a glow
sprite, at intensity 0.783, standing a kilometre under the county** — and all
sixteen slots occupied, because `litLamps()` binds by count and the spare spends
one. A record that is described in a comment as gone and is still there is the
failure this project is written against: nothing about it throws, nothing about
it is wrong-looking, and the only way to see it is to read the registry rather
than the frame. **The tell is a light at a coordinate nothing else is at.**

### The candle lantern

A hurricane lantern on an iron stake, in the walk of lamps beside the lane, in
five colours. It is the one prop in the county that is **three materials and four
meshes for the sake of three numbers**, and every one of the three is load-bearing.

**The stake is not in the photograph and it is the reason the piece exists.** A
lantern of that size stands a quarter of a metre on the ground, and a quarter of
a metre of glowing glass in the grass at the edge of a course is a lit weed: the
verge is two metres of meadow deep and a tuft is a third of a metre across, so the
reference's own base would have been under one. On an **86 cm stake** the panes
sit between **0.89 and 1.18 m** up, which is where `placeLamps()` puts every
other light and where the one it matters — the verge it lights — is. So the whole
of the geometry is a hand lantern and the stake is one extra rod.

**The light goes on the flame and not on the first tinted part, and this is the
one lamp in the county where that is not the rule.** `lampHeadOf()` — the rule
for a scattered piece — takes the *first* part that takes the tint, and for this
piece that would be the wax: a merged box running from the foot of the candle at
**0.896** to the tip of the flame at **1.130** has its middle at **1.013**, which
is **fifty-seven millimetres below the top of a hundred-and-fifty-millimetre
wax** — that is, inside the candle. A point light inside a closed lathe gives it
nothing at all, because every one of its faces has its normal turned away from it,
and the wax is then lit by the moon alone — **a red lantern's candle comes out
grey**. It is not fixed by raising the flame, and it is not fixed by lowering it
into the wax: `N · L` is negative over the whole of a cylinder's flank either way,
because the surface normal points outwards and an on-axis light is inwards of it.
So the flame is a part of its own — its box *is* the flame — and the four numbers
say which part was chosen: the flame's box is **1.072 to 1.130** and the wax's is
**0.896 to 1.070**, so the light sits fifty-five millimetres above the top of the
wax and the candle is lit from above, hot at the top and dark at the foot, which
is what a photograph of a lit candle is.

**A material's emissive is not multiplied by its vertex colour, and the wax is the
one surface in the county where that stops working.** `vec3
totalEmissiveRadiance = emissive;` is the whole of it — `emissiveColor` is the
other thing that touches it and `vColor` is not one of them — so every lit thing
in the county that wears an instance tint takes its colour in the *diffuse* and
burns warm cream out of the *emissive*, and that has been fine because a paper
lantern's own glow is a small warm lift on a surface the hour is already lighting.
The wax is the exception and the point light is why: it cannot be lit from the
flame, so its brightness has to come out of its emissive, and out of its emissive
in `LAMP_COLOUR` a red lantern's candle is cream. **The wax came out a dark
cylinder standing in a lit glass box.** A wax is translucent and the light that
lights it goes *into* it at the top and comes out of the flank, and that is a
second bounce three does not have — so it is written down instead, as
`totalEmissiveRadiance *= vColor` under `emissivemap_fragment`, and the wax is a
**tinted emitter**: a red lantern's candle really is red and a cyan one really is
cyan. The manifest's own note on `lantern-em` had been saying so all along, in one
line: *a tinted emissive with no map tints to nothing*.

**The flame does not get the injection, and that is the other half of the
reference.** A candle's core is paler than everything around it whatever colour
the wax is, so the flame stays in `mat.paper` and burns its own untinted cream:
hot core, coloured body. And it is a **separate material rather than a flag on
`mat.paper`** for the same reason the split into parts was: `mat.paper` is on
every paper lantern in the county and turning its glow into its tint would repaint
all of them.

**A pane has no emissive at all, and that is what makes it a pane.** The reference's
cyan lantern is cyan all the way out to its corners because the light behind it is
cyan, and the light is coloured by name off `lampPosts[].colour` — so a pane needs
no light of its own, it needs to be **lit by** the one in the middle of it. Give
it an emissive and it is a cream box around a cyan lantern, because an emissive is
not multiplied by the tint. Its material is also the one surface in the county
drawn at **a third of itself** (`mat.lampGlass`'s 0.9 is a lamp's solid globe; 0.9
on a flat pane is the candle behind two panes of tint), and it is the only
transparent thing here with `depthWrite` off: the panes are unwelded, so a pane
that wrote depth would let the fourth one drawn win the whole box and **the lantern
would turn inside out and show you its own back wall from the inside**.

**The power is 3 where the two kinds of lamp in the walk are on 9 and 7, and the
number is a choice about which of two things the lantern is for.** A point light
on a wick is **six centimetres** from the top of the wax and **a metre and a
tenth** from the grass it lights, and `decay` of 1.6 puts those **ninety times**
apart — so no single power serves both ends. At 6 the wax was five stops over
white and the meadow within four metres went the colour of the lamp: a cyan
lantern standing in a cyan field, which is the reference's *photograph* and not
its object. At 3 the glass is still a lit box with the frame showing through it,
and the pool on the grass is a pool rather than a flood. The glow sprite carries
the halo, as it does for every lamp in the county.

**And the colours are a different table from the paper lanterns', and the
difference is the point of having one.** A paper lantern is warm cream most of the
time because warm cream is what paper is. A candle lantern is four panes of clear
glass with a flame in the middle: there is no colour in the object at all until
somebody chooses one, so a walk of them in five creams is a walk of street lamps
in five shirts. `CANDLE_COLOURS` is **red, cyan, magenta, green, orange and two
creams** — two creams and not one because a walk of seven different colours is a
**fairground** and a walk of five with two ordinary ones in it is a lane somebody
lights. They are **sRGB hexes and not names out of the jar**, for the reason the
flowers' are: a colour here arrives as an `instanceColor` tint, so it wants the
number the lantern is painted in. And none of them is white, because a candle
lantern is a hand's width across at race distance and a white one reads as a stone
on a stick.

**A probe belongs to a pool's material, its injection does not.** The reflection
row gives every water surface a `CubeCamera` on a `WebGLCubeRenderTarget`, a
PMREM pre-filter, and the pre-filter is the only form a `MeshStandardMaterial`
will read as an environment in r155 and later — a bare cube target in `envMap`
contributes nothing, not something wrong. Probes are made and unmade as the row
moves, one refreshed per 260 ms from the frame loop so a burst of changes is paid
for gradually, and `syncProbes()` is what both `startRace()` and
`openInspector()` call, because the course you walk is the course that gets
raced. `waterFresnel()` is therefore guarded per *material*: `onBeforeCompile`
chains, so a second call on a material that already has it puts a second
`uniform float uWaterFresnel;` in the same shader, and that is a redefinition
and not a warning — the pool loses its program and draws wrong with nothing in
the console but the compile error. The same is true of the old pre-filter on a
probe whose resolution changed: it is a render target, so it is disposed.

**Four rows put the stage down and up again, and the rest apply as they go.**
`STAGE_ROWS` is `props`, `grass`, `shadow` and `refl`, and nothing else: the
first two are read while the stage is built, the third is stamped onto each
piece as it is planted, and the fourth hangs a probe off the stable's own pool.
Everything else is a uniform or a renderer knob and lands on the next frame.
`buildStage()` in `src/stage.js` uses seed 1177, and `restage()` asks the app for
`applyLook()` afterwards, so a rebuild puts the same county back at a different
density wearing the same snail — which is the point, and also why
`renderer.info.memory.geometries` coming back to the same number after four
rebuilds is the test for a leak. **The comparison has to hold the density still**,
though: `buildStage()` merges per piece and not per count, so a hub at `props: 1`
and a hub at `props: 2` are two different numbers of geometries and the first version
of that test read the difference as a leak.

**Cloud shade and wind are uniforms on five long-lived materials, injected once,
and only two of the five take the wind.** `gfxSurfaceTargets()` runs at setup and
never again, because `mat.course`, `mat.road`, `mat.ledge`, `mat.grass` and
`mat.foliage` already carry an `onBeforeCompile` of their own in three cases out
of five and `afterCompile()` chains rather than replaces. Both effects ride the
frame loop's own `clock`, not a second one: two effect clocks that are not the
same number drift apart within seconds, and a shadow sliding one way over grass
leaning another reads as two effects rather than one.

**The wind's gate is `max(transformed.y, 0)`, which is height in *world* space,
and that is the whole reason the ground cannot have it.** It is right for a tuft,
whose geometry is authored with its root at its own origin, and it is the height
of a hillside for a surface a hundred metres across with no origin to subtract.
The top of Crag Ascent's lane stands **35.9 m** over the meadow at its foot, so
every vertex up there carried a bend of 35.9 and an amplitude of `0.055` moved
the terrain itself by **1.98 m**: the county waving, the clay ribbon shearing out
of its own flank, and the flank left standing where the ground used to be. So
`gfxSurfaceTargets()` passes `false` for `mat.course`, `mat.road` and `mat.ledge`
and `true` for `mat.grass` and `mat.foliage`, and the three lines of GLSL are
left out of the first three's programs entirely rather than multiplied by zero.
The tell, if it ever comes back, is that the wind moves with **altitude** rather
than with what is standing up.

**A tree that moves in the colour pass and not in the occlusion buffer is a
tree twice.** `GTAOPass` builds its normal-and-depth pass by setting
`scene.overrideMaterial` to three's own `MeshNormalMaterial` — a material the
county never wrote and has no uniform on — so grass and foliage leaned one way
in the beauty pass and stood still in the AO: a ghost of their own canopy
hanging under it, **22 cm** of the county's own shape doing nothing, which is
the one thing in the frame that is not in the frame and reads as a shadow the
sun is not casting. `gtaoWind()` puts the **same `GLSL_WIND` the surfaces
wear, off the same two shared uniforms**, into that material, so the two
programs cannot disagree about where the field is. A displacement has to be in
every program that rasterises the geometry, and the occlusion buffer is one of
them whether or not anybody remembered it was there.

**Which pieces bend is an attribute and not a uniform, because a uniform is the
one thing that cannot carry it.** `WebGLRenderer.setProgram()` uploads a
material's own uniforms inside `if ( refreshMaterial )`, and `refreshMaterial` is
raised by `material.id !== _currentMaterialId` — *the material changing*. The
occlusion buffer is one material for the whole county, because `GTAOPass` sets
the override once and calls `render()` once with it, and `_currentMaterialId` is
cleared once per `render()` and nowhere else. So a uniform written from
`object.onBeforeRender` reached the GPU **once per pass**, carrying whichever
piece happened to be first in the render list: either the whole county bent in
the AO — the ground with it, and 35.9 of bend on the top of Crag Ascent's lane
is 1.98 m of the terrain itself — or nothing bent at all, which is the ghost the
paragraph above is about. It was never a shader and never a hook. An attribute is
what a vertex shader can be told per piece that three really does re-read per
piece, so the answer is **one float per vertex on the geometry**, and
`USE_INSTANCING` was never the gate it looked like: a stone is instanced too, and
a stone that sways in the occlusion buffer and not in the colour is the same
ghost a hand smaller.

**The geometry is the right granularity because a geometry wears one material in
this county** — `matFor()` and `partMat()` make a converted prop's material a
function of its own geometry, and the seven unconverted props that wear a wind
material are planted in one material each — and `windMark()` goes on at the two
places a piece is planted, `scatter()` and `planted()`, beside the shadows row's
flag and for the same reason: a flag applied by walking has to be reapplied every
time the county is rebuilt. **The zero is `material.defaultAttributeValues` and
not an omission**, because the ground, the road, a stone, the snail and three.js's
own geometry carry no attribute at all and the same program reads every one of
them: a missing attribute is not an error in WebGL, it is the value nobody wrote,
which is the fact `triplanarDetail()` lives with on the other side of the same
file. **`WIND_MATS` is filled when `gfxSurface()` is called and not inside its
`onBeforeCompile`**, because a piece planted before the first compile looks its
material up in an empty set and is never marked, and it then never bends in the
AO and never stops. Three's depth material is left standing still and that is
the one thing here still not true: a tree's shadow is its rest pose, and 22 cm
of a four-metre canopy with a soft edge was never what a ghost with a hard one
was.

## Checks

    tools/check.sh          # parses all eleven modules and reads the graph
    node tools/plan-test.mjs # the planner, in Node, with no browser
    node tools/plan-test.mjs --faces   # the wardrobe, and the ladder's own numbers
    node tools/plan-test.mjs --biomes  # the biome table, and the props behind it
    node tools/plan-test.mjs --seasons # the cups, and what each of them asks of you
    tools/e2e/run.sh         # 23 Playwright tests, about ten minutes, on a port of its own
    GOLDEN=1 tools/e2e/run.sh # ...or put the golden specs back in

`tools/check.sh` is the gate that knows about the split: it parses each module
under an `.mjs` name and then runs `tools/wired.mjs` over the whole graph, which
reports a name a file imports that another module does not export, a name a file
reads bare that another module declares, **a field of `world` that is read and
written by nobody**, and **a top-level read of a `const` declared below it**. The
last two are the ones the split invented, and both of them are failures with no
symptom: an empty default reads as a quiet answer, and a temporal dead zone reads
as a crash on the module's first line. **The gate reads its root off its own
location**, and it is not a detail: `check.sh` hands it a relative file list, so a
hardcoded path made it validate whichever checkout the author happened to be
sitting in while a clone with a genuinely broken import reported `11 modules` and
exited zero.

**`tools/e2e/run.sh` pins the bottom preset at render scale 1× so the direct path
is the one under test, and it asks the OS for a port rather than naming one.** A
gate that reuses whatever holds a fixed port tests whatever is holding it, which
is the one arrangement in which a green run means nothing: a checkout that could
not boot reported twenty-six passes against a healthy server left over from the
last one. `PORT=9000` still asks for a specific port.

**`golden.spec.js` is off by default and `GOLDEN=1` puts it back, and the rating scale
is why.** Those two specs compare the whole of every course - the lane to four decimals,
the terrain to six, a whole simulated race's order and times - against a baseline
captured under the old rating, and the fields the new `makePool()` draws are different
animals. **The plan half of those comparisons is unchanged and still true**, which is
why the file is gated rather than deleted; a default run that reported 26 passes with it
in would be claiming to have compared numbers it never compared.

**The simulated half is not comparable at all, and it is worth knowing how far.** Three
runs of the *same* build on `dash` came back at **66.04, 65.88 and 66.28 seconds** and
places **3, 1 and 5** — so `got.time` and `got.field` are gateing on frame timing, and
no change to them can turn them green.

**And the standing half is a gate with a shape worth naming**, because it caught two real
regressions in the biome work and its failure reads like a picture. The register is a
**count of draws**, and the lantern poles are the only prop on a course whose count is
sensitive to it: a mushroom asked for sixteen and given sixteen looks the same from any
draw, and a pole asked for ten and given three looks different from every one. So
`populate()`'s table is a gate on **the order of the `rand()` stream and not only on the
counts**, and the two things it caught were a duplicated `rock` slot running on every
course, and a pole options object built before the arches existed.

**The two fields a biome added are stripped in `captureSim()` and not in the assertion**,
because `baseline.json` is the pre-split capture and may never be regenerated — a report
carrying them can only ever differ from it. They are asserted in `biome.spec.js`
instead, which is where a course's biome is the subject rather than an accident.

**The pin is a literal in `tools/e2e/tier.js` and a spec checks it against the
game.** It is not derived from `src/graphics.js` because there is nothing to
derive it from — each row carries its own ladder and `gfxRowValue()` picks the
cell, so parsing the source would be reimplementing that function in a regex. A
literal rots quietly, because `gfxLoad()` drops a key it does not recognise and
keeps the game's own default; so `smoke.spec.js` boots at exactly that object and
asks `gfxAgreed()` whether it is still preset 1, which is the code that writes
presets agreeing out loud.

`tools/e2e/capture.spec.js` is the one spec that must never run again — it
rewrites both committed artifacts and it may only ever be taken from the
pre-split game.

Then serve it and watch the console. The things that actually break, in order of
likelihood: an `InstancedMesh` whose count is exhausted so the last pieces
vanish (raise `tries` rather than the count), a prop file that is not in
`MESH_FILES`, a merge that returned null, a map name with no file behind it, and
`dropCourse()` not being told about a resource you added.

A whole course, opened and closed through the inspector, and one race run to the
end, is the bar for a change that touches the world. The inspector is WASD to
walk, mouse to look, `Q`/`E` down and up, `Shift` to move faster, `Esc` out.

## The save

`localStorage['snail-grand-prix-v1']`, written only on a real event — a race
result, a purchase, a new game — so it can look empty mid-session and that is
not a bug. `state` carries the season, tier, rating, gold, the snail's five
stats, the 64-entry rival `pool` and the season `field`.

Do not leave a test run in it. It is normally season 5, Sunday Cup, rating 130,
165 gold, stats `running 20 / power 15 / swimming 10 / flying 13 /
stamina 12`, no results. To verify, read the key; to restore, write those fields
onto a valid save and reload. A save with a `pool` that is not 64 entries of
`{attrs, rating}` is rejected and the player gets a new game.
