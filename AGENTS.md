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
| `meshes/tex/*.png` | the maps the props wear, one folder, loaded by name |
| `meshes/maps.js` | **the map manifest** - which piece declares which map, and why |
| `meshes/palette.js` | **the colour jar** - every colour in the project, linear |
| `meshes/build-*.html` | pages of three.js that generate some of those files |
| `tools/` | the server, the static gates, the browser tests, and the model pages |

### The eleven modules

The graph is a chain and a fan, and **the one rule it obeys is that `world` is the
only thing that goes sideways**. Every edge below is an import; the sideways lines
are not, and they are `src/graphics.js`'s registry.

| | lines | what it is |
|---|---|---|
| `src/core.js` | 562 | data, tuning, seasons, noise, geometry helpers, and the one three.js import |
| `src/plan.js` | 831 | the pure planner: no three, so Node can import it and `tools/plan-test.mjs` can ask it |
| `src/graphics.js` | 1,079 | the settings ladder, the renderer, the dome, and **`world`** |
| `src/materials.js` | 1,253 | the glb loader, the material jar, the palette adapter, the shader injectors |
| `src/course.js` | 716 | the track samples, the frame, and `groundYAt()` |
| `src/surfaces.js` | 1,463 | the four surfaces, the water, and the half-way |
| `src/scenery.js` | 1,533 | the tower, the lamps, `scatter()`, the farms, the backdrop |
| `src/post.js` | 1,774 | the settings panel, the chain, the probes, the readback |
| `src/race.js` | 1,397 | the snail, the field, the sim, the crates, the save |
| `src/stage.js` | 696 | the stable and its rebuild |
| `src/app.js` | 1,965 | the camera, the frame loop, the perf panel, every screen, the boot |

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

three.js 0.160 is imported from a CDN and nowhere else, as a **top-level `await`
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
    window.__shellExport('swirl', 'shell-swirl.glb')
    window.__snailExport('snail.glb')
    window.__texExport('rock-n')                // -> meshes/tex/rock-n.png

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
boxes, attributes and maps, and audits the whole manifest at the foot. All three
take the maps out of `meshes/tex/` themselves, the same way the game does, and
`?maps=0` puts them back the other way. `tools/README.md` is the full reference.
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

## Settings

`#optbar` opens `#options`: a grid of six buttons, each a whole preset, over ten
rows that can also be set one at a time. The rows are `render` (device pixel
ratio, as a multiple of native, capped), `msaa` (`off / x2 / x4`), `scale`
(`nearest / bilinear / bicubic`), `distance` (fog
and the width of the ground beyond the draw distance), `shadow` (map size, radius
and whether props cast at all), `props` and `grass` (density), `sky` (dome
segments), `ssao` and `refl` (per-pool cube probes and how far they look). Six is
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

**Anti-aliasing was a context flag on one path and nothing at all on the other,
and it is a row now.** The renderer is built with `antialias: false`, which looks
like a step backwards, and is the whole of the reason the setting can exist. A
context's multisampled default framebuffer is free, which is why it was on; it is
also a context-creation parameter, so it cannot be changed at runtime, it is a
boolean and not a sample count, and `EffectComposer` builds its own pair of
targets at `samples: 0` — so a composer frame had no anti-aliasing while the same
picture without one had four samples, and there was no cell that could say anything
about either. **Two mechanisms that cannot be reconciled is the same as no
mechanism**, so `composerTarget()` hands `EffectComposer` a target at the count the
row asks for and `clone()` puts the count on the second buffer as well. `off` is
zero samples and not one, because a one-sample target is no target with more
bookkeeping on it.

**MSAA on the direct path is a render target, so the direct path is a chain.**
`needsComposer()` reads `ssao >= 2 || fxBloom > 0 || gfxMsaa() > 0 ||
needsResample()`, and a machine
that asks for x4 with the occlusion off gets `RenderPass` and `presentPass` and
nothing else — one scene render and one resolve. **The direct path is still
`renderer.render()` and still spends no render targets, but only because the row
says so**, which is the price of one setting meaning one thing on both paths
instead of two mechanisms that disagree.

**A sample count is baked into a framebuffer when that framebuffer is built, and
never afterwards.** So the count is not a uniform and there is no way to re-sample
a target that exists: `msaaKey` sits beside `composerUp` rather than inside it,
because the two cross independently — a count can change while the chain stays
wanted — and `syncComposer()` tears the chain down and builds it again when it
does. `WebGLRenderTarget.setSize()` disposes a target whose size moved, so the
framebuffer is rebuilt from `samples` and **the count survives the render-scale
row**, which is the one that resizes it.

**Three states and not six, so the row brings a table of its own.** `MSAA_PRESET`
is `[1, 1, 1, 2, 3, 3]` — off at the bottom three, x2 at High, x4 at the top two —
because three states cannot hold six numbers, and a cascade writing *N* into the
row would put a step it has no cell for on it and a cell it cannot reach in the
table. `gfxRowValue()` is the one function that answers "what does this row hold at
level *N*", used by both the write and the test, because **a row whose write and
whose test disagree is a preset that can never be recognised as itself**: Balanced
would write msaa 1, and reading `mixed` back for want of a row nobody compared.
Balanced is `off`, which is the picture the composer path has always drawn.

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

**The effects were a six-step stack and are now six switches, and a stack is a
bundle.** The `fx` row turned on everything up to its level, and the order it
stacked them in is the order of what they cost — a fullscreen quad, a uniform, a
composer pass — so the row was defensible as a ladder and was useless as a menu:
a player who wanted the cloud shade and not the film grain had no cell to press,
and the only route to that picture was to edit `localStorage` by hand. So the
stack survives as what it was always good for, `FX_PRESET`, the set a preset
writes, and `FX_TOGGLES` is the menu: glow, vignette, grain, cloud shade, bloom,
wind, one switch each, with the row's own cost in the caption where a ladder row
has the level's description. **A preset is still a full write**, so pressing
`Balanced` puts a grain you had just switched on back off — the same thing it
always did to the other rows, and the reason a preset is never a partial change
and never strands a player in a picture they cannot get back to. The bloom row
has three cells, `off / bloom / bloom hi`, because that is one effect at two
strengths and not two effects, and the ladder had both.

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
gfxMsaa() > 0 || needsResample()` —
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
lights are re-chosen every frame as the nearest ones and a glow that kept the
colour of the lamp it was on a moment ago is a glow on the wrong lamp.

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

Two things about doing it to the override rather than to a material of the
county's own. `USE_INSTANCING` is not the gate it looks like — a stone is
instanced too, and a stone that sways in the occlusion buffer and not in the
colour is the same ghost a hand smaller — so `uWindObj` is per object, and
`windMark()` goes on at the two places a piece is planted, `scatter()` and
`planted()`, beside the shadows row's flag and for the same reason: a flag
applied by walking has to be reapplied every time the county is rebuilt.
**`WIND_MATS` is filled when `gfxSurface()` is called and not inside its
`onBeforeCompile`**, because a piece planted before the first compile looks its
material up in an empty set and is never marked, and it then never bends in the
AO and never stops. Three's depth material is left standing still and that is
the one thing here still not true: a tree's shadow is its rest pose, and 22 cm
of a four-metre canopy with a soft edge was never what a ghost with a hard one
was.

## Checks

    tools/check.sh          # parses all eleven modules and reads the graph
    node tools/plan-test.mjs # the planner, in Node, with no browser
    tools/e2e/run.sh         # 26 Playwright tests, about a minute, on a port of its own

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
