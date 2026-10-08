/* ================================================================== *
 * core.js
 *
 * The leaf every other module imports, and the smallest of the eleven at 445
 * lines, which is the one fact about it worth stating first: it is the only
 * file under 500 and it is the one everything else sits on, so merging it into
 * a neighbour would save twenty lines and cost an edge for no gain in size.
 *
 * **The three.js `await` lives here and the whole split rests on it.** A
 * top-level `await` propagates through an ES module graph - every module that
 * imports this one waits for this one's body to finish - so a dependent's body
 * never runs before the CDN has resolved, and the twenty-one `new THREE.*`
 * calls at module scope in the modules downstream of this one are safe because
 * of a language feature and not because of an ordering convention somebody has
 * to remember. It was a single `await import()` in the game and it is one here,
 * and the try/catch around it is the game's own: a CDN that is unreachable says
 * so on the boot screen and stops, rather than leaving a black canvas and a
 * console full of nothing.
 *
 * **And the data is here rather than with the settings, which is not where the
 * plan put it.** `races.json` and `seasons.json` are fetched here, validated
 * here and exported from here, because the tuning table that checks every
 * course's `pool` needs `CATS` and the season ladder needs `SEASONS`, and the
 * graph has `core` at the bottom of it. Loading them in the settings module
 * would have had the tuning table import a module about fog and pixel ratio in
 * order to learn the name of a course, and that is a cycle rather than a
 * layering.
 * ================================================================== */

import { BIOMES, ROLE_KEYS, SET_ROLES, PAL_KEYS } from '../meshes/biomes.js';
// **The county is a browser and the planner is a node process, and this is the
// one place the two are told apart.** three.js comes off a CDN and the two data
// files come off a `fetch`, and neither exists under node - so both are behind
// one guard, and both are on the path a browser always takes, which is what
// makes the guard free at runtime and load-bearing in exactly one place.
//
// It is here because `tools/plan-test.mjs` imports `plan.js`, and `planTrack()`
// opens with `CAT_BY_ID[catId]`, so a node run needs the county's own courses in
// the module rather than a hand-written copy of them in the test. **And it turns
// the planner's bet into a fact**: `plan.js` uses no three.js at all - its
// design points are plain `{x, y, z}` - and `THREE` being `null` under node is
// what proves it, because a planner that reached for `THREE.Vector3` throws on
// its first point instead of quietly needing a shim.
const IN_BROWSER = typeof document !== 'undefined';
/** Say what went wrong on the boot screen, and stop. The screen is the game's
 *  and there is not one under node, so the throw is the half that always
 *  happens - and the three places below that used to write to the element and
 *  throw themselves are the same shape as this one. */
const bootFail = (msg) => {
  if (IN_BROWSER) document.getElementById('boot').textContent = msg;
  throw new Error(msg);
};
let THREE = null;
if (IN_BROWSER) {
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');
  } catch (err) {
    document.getElementById('boot').textContent = 'Could not load three.js from the CDN — connect and reload.';
    throw err;
  }
}
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (x) => x * x * (3 - 2 * x);
const $ = (id) => document.getElementById(id);
/**
 * Say something on the boot screen, **if there is one.**
 *
 * Every caller of this is a page that has failed to load its own data, and the
 * message belongs on the boot screen - which only the game has. A tool page has no
 * `#boot`, and `document.getElementById('boot').textContent = …` on nothing is a
 * `TypeError` that replaces the real error with one about the message: the tool
 * throws `Cannot set properties of null` where it should have thrown `404`, which
 * is the trade this line exists to stop.
 */
const say = (msg) => { const el = document.getElementById('boot'); if (el) el.textContent = msg; };
async function loadData(file, what) {
  let data;
  // **Beside this module, and not beside the page.** The node branch has always
  // resolved the path off `import.meta.url` so the tool runs from anywhere; the
  // browser branch fetched a bare `file`, which resolves against the document, and
  // the two branches agreeing here is what lets a page outside the project root
  // import this module at all. `snail-race.html` is one directory above `src/`, so
  // for the game the two spellings are the same URL and nothing about it moves; for
  // `tools/wardrobe.html` it is the difference between `/races.json` and a 404 off
  // `/tools/`.
  const url = new URL('../' + file, import.meta.url);
  if (IN_BROWSER) {
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      say(`Could not load ${file} — is it being served next to the page?`);
      throw err;
    }
    if (!res.ok) {
      say(`Could not load ${file} (${res.status}).`);
      throw new Error(file + ' ' + res.status);
    }
    data = await res.json();
  } else {
    // **off the disk, beside this module** - and the path is relative to the
    // module rather than to a working directory, so the tool runs from anywhere.
    const { readFile } = await import('node:fs/promises');
    data = JSON.parse(await readFile(url, 'utf8'));
  }
  // the shape check and the message are the same either way, so a file that is
  // not a list is rejected identically in a browser and under node
  if (!Array.isArray(data) || !data.length) {
    bootFail(`${file} did not contain a list of ${what}.`);
  }
  return data;
}
const [SEASONS, RACES] = await Promise.all([
  loadData('seasons.json', 'seasons'),
  loadData('races.json', 'courses'),
]);
const CATS = RACES;
for (const c of CATS) {
  if (typeof c.len !== 'number' || typeof c.scale !== 'number' || c.scale <= 0) {
    bootFail(`races.json: "${c.id || '?'}" needs a positive len and scale.`);
  }
  // the length the course is actually laid out to
  c.len = c.len * c.scale;
}
const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));
/* ================================================================== *
 * Tuning
 * ================================================================== */
const RUN = 0, CLIMB = 1, SWIM = 2, FLY = 3, WALK = 4, PUSH = 5, BOWER = 6;
/* What a snail covers a second at its best, by what it is doing. Every speed in
 * the sim is one of these times a factor for the trait that suits the ground and
 * one for how well the snail races. Footpath is the reference: everything else
 * is a fraction of a snail going along a flat path, and the gaps between them
 * are the whole argument for building a snail. */
const BASE_RUN = 4.5;                       // footpath
const BASE_CLIMB = 3.1;                     // a wall
const BASE_FLY = 2.8;                       // the air over a gap
const BASE_SWIM = 2.9;                      // water
const BASE_WALK = BASE_RUN * 0.9;          // the floor of a chasm: on its feet, on broken ground
const BASE_PUSH = BASE_RUN * 0.42;         // a crate: on its feet again, and a snail against a box
const BASE_BOWER = BASE_RUN * 0.78;        // 3.51 - leaf-covered road, and it is still road
const CLIMB_GRADE = 0.5;                    // how hard a wall's steepness bites on the speed of a climb
/** The lane everywhere else: half of five and a half metres, and eight abreast. */
const LANE_HW = 2.8;
/**
 * The crate, and it is seven numbers and one shape.
 *
 * **A crate is a cube**, and that is the whole of its silhouette: a long low box
 * reads as a plank with sides on, and the thing a snail pushes across a road is a
 * box with boards on it. So all three of its edges are `CRATE_S`, and the model
 * is built to that number rather than fitted to anything.
 *
 * **And `CRATE_S` is set by the lane and not by taste.** The lane is five and a
 * half metres wide and eight racers abreast, which is 660 mm of pitch, and a
 * crate for every racer has to sit in its own 660 mm with air either side of it:
 * 620 mm leaves forty. That is a crate about the size of the snail pushing it,
 * which is what a fruit crate is, and it is also the only cube the county has
 * room for - a metre and a half cube would overlap its neighbour by nine hundred
 * millimetres.
 *
 * **The dish is the crate's own size, and its ends are cut rather than eased.**
 * `CRATE_X` is its length in the planner's `x`, and the whole of the drop is
 * taken in the **first sample** of it and the whole of the rise in the last -
 * which is what a `leap` does with its chasm and the reason a leap reads as a
 * hole. Eased over a quarter at each end it came out as a trough: `CRATE_X` was
 * 2.8 m of `x`, the dish 3.4 m of road and 0.45 deep, and a bowl you could put a
 * cart in. **A crate is 620 tall, so a hole it bridges cannot be a `leapClimb`'s
 * cliff and it is not pretending to be one** - the 2.6 m of water under a
 * `leapClimb`'s lip is what makes that face stand at seventy degrees, and a
 * notch a snail is meant to walk a box across is half a metre of the same
 * bargain. What the notch can be is a **crease**: a hard lip taken in one sample,
 * a bare stone floor, and a length of about the box's own, so the crate fills it
 * and overhangs it and the road is broken where the crate stands.
 *
 * **And the crate's lid is the road.** The depth is a little under `CRATE_S`, so
 * the box stands ninety millimetres proud of the clay at each end of a bridge
 * that is otherwise level, and the whole of the obstacle is a nine-centimetre
 * step on and off a hole. The snail is on the lid from the near lip to the far
 * one and never in the notch, so a notch the crate does not cover is not a hole
 * a snail has to climb out of.
 *
 * `CRATE_BACK` is how far back the crate starts, and `CRATE_GAP` is the snail's
 * own `s` to the crate's centre: it begins shoving the moment the crate is that
 * far ahead of it, so the shove run is the two of them together and `CRATE_LANE`
 * is the clear road a course has to give it, in the planner's `x` - which is the
 * shorter of the two distances here, so a floor in `x` is a longer run in `s` than
 * the number looks.
 *
 * **And the apron a crate is shoved down is a wider lane and not a wider crate.**
 * Eight abreast at `LANE_HW` is 657 mm of pitch and a cube of 620 leaves 37
 * between neighbours - and the field does not hold the slot it was given, it
 * drifts a snail 120 either side of it, so two of them met with 200 mm of
 * overlap and a row of boxes that walked sideways down the road as it went. So the
 * road opens out to `CRATE_HW` for the whole shove, which is 857 of pitch and 240
 * of air, **and the field's lane is a share of the half-width rather than a
 * distance off the centre line**: a road that opens for a crate is a road the
 * eight of them spread into, and a crate row stepped wider on its own would be
 * eight boxes standing in the verge with a snail walking between two of them.
 *
 * The apron opens over `CRATE_FLARE` and not at a row, because a row is 0.75 m
 * apart and the edge would step a third of a metre sideways between two of them,
 * which is a crease and not a shoulder. **And it is the drift that goes and not
 * the width alone**, read off the same `fr.w` the slot comes off, so the wander
 * reaches nothing exactly where the road is widest and a snail with its hands on a
 * box walks it straight.
 *
 * **And the notch is packed, which is the whole of what makes it a hole.**
 * A hole cut in a lane is only the shape its samples carry: the lane carries one
 * row every `STEP`, so a notch cut across it has two walls a whole row apart and a
 * floor of no length at all - a crease, and a crease reads as rounded however deep
 * it is. So `roadRows()` lays four rows of its own either side of the two lips,
 * `CRATE_WALL` apart on each side, which puts the drop into eight centimetres of
 * arc and leaves a floor the width of the crate between them: eighty-four degrees
 * of wall, a floor of six hundred and seventy, and a box that fills it. **All three
 * of those meshes take the packed rows and not the samples** - ribbon, flank and
 * ground - because the ground's surface is a straight line between two samples it
 * was given, and a ground that eases down the notch over three quarters of a metre
 * puts a hillside over the bottom two thirds of the hole.
 */
const CRATE_S = 0.62;                       // a cube crate: side, and height, and width
const CRATE_X = 0.95;                       // the dish's length in design x: about the crate's own
const CRATE_BACK = 2.6;                     // the crate's start centre, back from the near lip
const CRATE_GAP = CRATE_S / 2 + 0.25;       // the snail's `s` to its own crate's centre
const CRATE_LANE = 3.0;                     // clear road a crate needs in front of its dish
const CRATE_HW = 3.5;                       // the half-width of the apron, and not the half-width of the county
const CRATE_FLARE = 1.2;                    // metres either side of the shove over which the lane opens
const CRATE_WALL = 0.04;                    // metres of arc either side of a lip: the wall is twice this


const HOURS_PER_SECOND = 1 / 60;            // a minute of racing is an hour of the day: the clock a course is raced on
const LEVEL_Y = 0;                          // the height a course runs at when it asks to run level
const POOL_BANK = 5.2;                      // how far a pool's water reaches past the lane's own edge
const POOL_SPREAD = 0.28;                   // and how much wider it gets for every metre of gap
const POOL_BERM = 1.4;                      // and how far the sand keeps on past the water's edge
const COND = [
  { key: 'run',   name: 'footpath', attr: 'running',  base: BASE_RUN,   cls: 'run' },
  { key: 'climb', name: 'wall',      attr: 'power',    base: BASE_CLIMB, cls: 'climb' },
  { key: 'swim',  name: 'water',     attr: 'swimming', base: BASE_SWIM,  cls: 'swim' },
  // A gap is only a gap while you are in the air over it. The bottom of one is
  // ground like any other, and it is a separate state so a snail that missed
  // the jump is walking on the floor of the chasm at walking pace - on its
  // feet and on its running, not flying along it.
  { key: 'fly',   name: 'gap',       attr: 'flying',   base: BASE_FLY,   cls: 'fly' },
  { key: 'walk',  name: 'walking',   attr: 'running',  base: BASE_WALK,  cls: 'walk' },
  // A crate is a wall you push through rather than over, and it is **appended**
  // and not inserted: the index of every condition is load-bearing for the
  // progress rail, the card's stroke list and the readout, and a sixth in the
  // middle of this array moves all three without one of them saying so.
  { key: 'push',  name: 'crate',     attr: 'power',    base: BASE_PUSH,  cls: 'push' },
  // **A bower is footpath under thirty metres of fallen leaves, and it is here
  // because a condition *is* a trait test** - `race.js` reads `COND[cond].attr`
  // and `COND[cond].base` and multiplies them by the snail's `eff[attr]`, so a new
  // condition is the whole of a new obstacle that tests something. **The trait is
  // `running` and not a new one:** this is the third ground `running` decides
  // (`run`, `walk`, and this), and a sixth key in `ATTRS` would move the rating
  // ceiling the whole ladder is measured against. **The fast snails still win
  // it.** They win it by less, which is what makes it a test rather than a wall.
  //
  // **And it is appended for the same reason the crate was** - the seventh, and
  // the index of every condition is load-bearing for the progress rail, the card's
  // stroke list and the readout. Six of the eight consumers of `cond` exclude it
  // by *omission*, naming the two or three they do want, which is the county's own
  // discipline; the gates in `tools/plan-test.mjs` are what turn that into a check.
  { key: 'bower', name: 'litter',    attr: 'running',  base: BASE_BOWER, cls: 'bower' },
];
const ATTRS = [
  { key: 'running', name: 'running' },
  // **Power, and not climbing.** It is the stat that gets a snail up a wall, and
  // it is also the stat that shoves a crate across a hole - and a name that said
  // `climbing` was a name that read as a description of the first of those two
  // jobs and said nothing about the second. `EFFor` reads every key in this list
  // out of a save without asking, so the rename is a save **version** and not a
  // migration: see `load()`.
  { key: 'power',    name: 'power' },
  { key: 'swimming', name: 'swimming' },
  { key: 'flying',   name: 'flying' },
  { key: 'stamina',  name: 'stamina' },
];
/**
 * The things a course is made of. A `leap` is a cliff and a gap with nothing
 * in it: the far side is the floor of a chasm a long way down, so a snail
 * that does not make it is down there climbing back out, and it is taken at
 * height. A `water` is a pool - the same hole much smaller, with water in it,
 * a bank low enough to step off and a hop so low there is no flying over it -
 * so it is water you get through rather than a hole you fall into. A course
 * that lists only `leap` has no water on it at all, and one that lists
 * `water` has no chasms; that is what makes a course a swimming course or a
 * flying one. A course says which elements it has in the `pool` list in
 * races.json, and that list can name the same element twice for it to come
 * round more often.
 */
const ELEMENTS = {
  run:   { x: 12.0 },
  climb: { x: 5.2 },
  // **A bower spends `x` on the length and draws a section of its own**, which is
  // the same bargain `run` strikes - `run` reserves twelve and draws ten to
  // sixteen - and the reservation is what the course's own arithmetic is solved
  // against. **So the two numbers are read from one place** (see `long` in
  // `plan.js`'s `lay()`), because `atX` is what the middle band and the half-way
  // mark are computed from, and if one line advanced by `x` while the geometry was
  // drawn at the section's own length then the plan's arithmetic and the lane
  // would drift apart by metres and the tower would land off the clear middle.
  bower: { x: 26.0 },
  leap:  { x: 18.0, wet: false, gap: 1.00, lip: 1.00, chasm: [0.9, 1.3], back: 2.2, vy: 0.71, lipW: 0.9 },
  water: { x: 15.0, wet: true, gap: 0.62, deep: 0.42, lip: 0.24, drop: 0.40, bank: 2.3, vy: 0.40, lipW: 0.95 },
  // A flooded chasm, and the hardest thing on any course: a slope to run up,
  // a cliff to launch off it, deep water at the bottom, and a wall on the far
  // side. Fly far enough and you come down on that wall and climb it; come
  // down short and you are swimming, and then you climb out of the water the
  // same way - so the same wall is the prize at either end of the fall.
  leapClimb: {
    x: 20.0, wet: true, wall: true, runUp: 0.55,
    gap: 1.05, deep: 2.2, lip: 3.0, drop: 2.6, back: 2.6, vy: 0.75,
    lipW: 0.94,
  },
  // A **dish cut in the road for a crate to stand in**, and the only way over it
  // is to shove the crate into the middle of it. It is a `leap` with two things
  // turned off, and each of them is a thing a `leap` does for a different reason:
  //
  // - `noLip`: there is no launch, because nothing jumps a crate. The *ramp* is
  //   skipped and the flat top is not - see the branch - and `lipX` ends up on
  //   the road, which is the only height a crate can be shoved along.
  // - `crate`: the span is `PUSH` rather than `WALK`, so the progress rail and
  //   the card have a colour for it and a snail that ends up on the floor of one
  //   moves at crate pace rather than walking pace.
  //
  // **And the dish's ends are cut and not eased**, which is the load-bearing half
  // of it and is in the samples rather than in this declaration. The road on a
  // course is sampled every 750 mm, so the shape of a notch is only the shape its
  // samples carry, and a notch the planner eases over the first quarter of its
  // length in each direction comes out as a trough: a cart could have stood in
  // this one. **The whole of the drop is in the first sample of the dish and the
  // whole of the rise in the last**, which is what a `leap` does with its chasm,
  // and what comes out is a lip. It is not a `leapClimb`'s cliff and does not
  // pretend to be: 2.6 m of water under that lip is what stands a face at seventy
  // degrees, and a notch a snail is meant to walk a box across is half a metre of
  // the same bargain. It is a crease and not a bowl, and the crate is its own
  // size, so the box fills it and overhangs it rather than standing in a hollow
  // with a trench round it.
  pushCrate: {
    x: 5.0, wet: false, crate: true, noLip: true, farRise: 0.15,
    chasm: [0.50, 0.56],
  },
};
// Each element needs the numbers it is built out of, and a leap needs no
// depth and no water: it is a hole, not a pond. Say so at boot rather than
// half way round the first lap.
const NEEDS = {
  run: [], climb: ['climb', 'climbRun'], leap: ['gap', 'lip'], water: ['gap', 'lip', 'deep'],
  leapClimb: ['gap', 'lip', 'deep'],
  // nothing: the gap is the element's own and the crate is put there by hand
  pushCrate: [],
  // **nothing, and written down rather than omitted**, because an absent `NEEDS`
  // entry and an empty one are the same answer and one of them is a fact while the
  // other reads as an oversight. A bower needs no gap, no lip, no deep and no
  // climbRun, because **it is not a hole and it does not lift the course**: its
  // road is the course's own road and the only thing about it that is not the
  // course is thirty metres of leaf lying on top.
  bower: [],
};
/**
 * And a biome, which **stops the boot for the same reason and with the same
 * shape of message.** `biome` was written on every course before anything read
 * it, and a course whose biome name nothing has heard of would come up
 * temperate: a meadow with a dead valley's name on it, and nothing anywhere
 * saying so, because `useBiome()`'s fallback is a plausible biome and a
 * plausible answer to a question nobody asked. So the name is checked here,
 * beside the pool check, and the message carries both ids.
 *
 * **The role, palette and prop checks are not here and are in
 * `tools/plan-test.mjs --biomes` instead**, because they are about the biome
 * table rather than about a course: a role naming a `SURFACE` key nothing has
 * heard of, a `pal` that is fifteen long and a sixteenth quietly left at
 * temperate's, a prop with no glb behind it. All three are a gate and none of
 * them is a crash, and a gate is where a list can be walked.
 */
for (const c of CATS) {
  if (!BIOMES[c.biome]) {
    bootFail(`races.json: "${c.id || '?'}" is in a biome called "${c.biome}", which is not one of ${Object.keys(BIOMES).join(', ')}.`);
  }
}
for (const c of CATS) {
  const unknown = (c.pool || []).filter((k) => !ELEMENTS[k]);
  const missing = (c.pool || []).filter((k) => (NEEDS[k] || []).some((f) => !Array.isArray(c[f])));
  // every element a course names is dealt into the course at least once, so
  // it needs room for all of them
  const tooMany = Array.isArray(c.pool) && new Set(c.pool).size > c.feats;
  if (!Array.isArray(c.pool) || !c.pool.length || unknown.length || missing.length || tooMany) {
    if (IN_BROWSER) {
      document.getElementById('boot').textContent =
        `races.json: "${c.id || '?'}" needs a pool of known elements` +
        (unknown.length ? ` (unknown: ${[...new Set(unknown)].join(', ')})` : '') +
        (missing.length ? `, and for the rest: ${[...new Set(missing)].map((k) => NEEDS[k].join('/')).join(', ')}` : '') +
        (tooMany ? `, and at least ${new Set(c.pool).size} feats for the ${new Set(c.pool).size} different elements it names` : '') + '.';
    }
    throw new Error('bad course ' + c.id);
  }
}
const STAT_MAX = 24;
const STAT_MIN = 1;
const GOLD_PER_FRUIT = 10;
const START_GOLD = 50;
const START_TRAIT = 5;                        // every trait a new snail begins on
const freshSnail = () => ({ running: START_TRAIT, power: START_TRAIT, swimming: START_TRAIT, flying: START_TRAIT, stamina: START_TRAIT });
const POINTS = [25, 20, 15, 10, 5, 3, 2, 1];              // 1st through 8th, and the gold they pay
const FIELD = 8;                            // the player plus seven rivals
const POOL_SIZE = 64;                       // the rivals are drawn from here
const CLUB_SNAILS = 9;                      // ...and the bottom rung of it is this many club snails
const CLUB_ATTR = 3;                        // three of everything, every one of them
const ATTR_MAX = 16;                        // a rival's attributes run 1 to 16
/* ================================================================== *
 * The rating, and it is two numbers and a shape.
 *
 * **A rating is a snail's attributes, read through a curve**, and not a running
 * average of the points it has scored. The old formula derived one from the
 * other - `START_RATING + (pts / races) * RATING_PER_WIN` - and the top of it
 * was **60**: twenty-five points is the best average there is, so no amount of
 * winning could take a snail past sixty, against nine club snails on 150. A
 * player who won every race in the county for a season finished the season
 * forty points below the foot of the pool, and **rank one was not reachable at
 * all**, which is why nothing that hangs off being first on the ladder could be
 * built until this was.
 *
 * So the rating is the animal rather than the record, and the record -
 * `races`, `pts`, `wins`, `avg` - stays on every rival because the season draw
 * leans on it and a ladder does not need it twice over. `ratingFor()` no longer
 * reads it and no longer writes it.
 *
 * **The curve is `total ^ RATING_POW` at `RATING_SCALE`, and the exponent is
 * the whole of it.** Five traits of `ATTR_MAX` is 80 and that is `80 ^ 0.8 * 20`
 * = **666**, against 15 for the nine club snails at `175`. Linear on the total
 * would be 800 against 300, which reads as a cliff between the foot of the
 * ladder and the bottom rung; the exponent compresses the top without lifting
 * the bottom, so the nine are 175 and the best snail in the county is 666 and
 * the gap between them is three and three-quarter times rather than two and
 * two-thirds. **A rating of 1 is not 5** and the ladder floor is where the nine
 * are, not at zero.
 *
 * **And `RATING_GAIN` is a race, not a target.** A win is worth eighteen and a
 * last place costs nine, which is the shape a ladder wants: a good race moves
 * you up and a bad one moves you down, both in one number you can read on the
 * results screen. `PODIUM_FLOOR` is the guarantee underneath it, applied
 * *before* the cup's `payMult` so that a first place in the Sunday Cup is at
 * least three and a first place in the GP is at least three times `payMult` -
 * a cup that pays more pays a bad race no less, and the one promise the ladder
 * makes is that turning up wins something.
 * ================================================================== */
const RATING_SCALE = 20;
const RATING_POW = 0.8;
// **And the numbers in `RATING_GAIN` are the length of the ladder, not a
// flourish.** Five races at thirty a race is a hundred and fifty, which takes a
// fresh snail from 10 to 160 and puts the Open's door at 160 exactly - so one
// clean Sunday Cup season is one rung up, the Invitational opens after a second
// and the GP after a third, by which point the snail is on 655 and standing on
// the ladder's top rung with nothing above it. **Three seasons to be first**, and
// the Adversary is what is waiting on the other side of that, so a ladder that
// took ten seasons would make the unlock a grind and one that took one would
// make it a formality. The bands in `seasons.json` are written off these
// numbers, and that is the coupling: move the gain and the four doors move.
const RATING_GAIN = [30, 20, 14, 9, 5, 1, -2, -6];     // 1st through 8th, in points of rating
const PODIUM_FLOOR = [3, 2, 1, 0, 0, 0, 0, 0];       // and the floor under the podium, whatever the table says
const START_RATING = 10;                    // where the player starts on the ladder
const RATING_MIN = 5;
const RATING_MAX = 1280;                    // and the ends it is clamped to
const RATING_STEP = 60;                     // the most one race can move a rating, either way
/** A rival's rating, from its attributes: the curve above, read once, at build. */
function ratingOf(total) {
  return Math.round(Math.pow(total, RATING_POW) * RATING_SCALE);
}
const SURGE_MULT = 1.18;
const SURGE_DRAIN = 11;
const PASSIVE_DRAIN = 0.90;
const TIRED_MULT = 0.25;                    // quarter speed on an empty bar
const SWIM_Y = 0.18;                         // how deep a swimmer sits
const REGEN = 6.0;
const STEP = 0.75;                          // track sample spacing
const START_S = 11.0;                      // the start line, measured in from the end

// Everything that counts the season reads the roster out of seasons.json, so
// a season can gain or lose a course without leaving a stale number behind.
const seasonWord = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);

/**
 * **The four traits a cup is made of, and it is four of the five.**
 *
 * A course names the trait it tests and the card prints it, so a season's card is
 * four claims about what the ladder asks of a snail - and `stamina` is not one of
 * them, because stamina is not a course: it is the bar the Grand Marathon drains
 * (`drain: 0.6`) and the fifth stat every snail grows. **So the roster is asked
 * for one of each of these four and the marathon is what tests the fifth**, and a
 * number here that is not four would be a season quietly asking for something the
 * county has no course for.
 */
const RACE_TRAITS = ATTRS.filter((a) => a.key !== 'stamina').map((a) => a.key);

/* ================================================================== *
 * The seasons, read out of seasons.json. The bands are allowed to overlap,
 * so a snail can be good enough for two seasons at once and pick either -
 * the ladder is a choice, not a queue. Everything about a season comes out
 * of its own entry, so a season can gain or lose a course, or move up the
 * ladder, without touching any code.
 * ================================================================== */
const TIERS = SEASONS.map((s) => Object.assign({}, s, { hi: s.hi == null ? Infinity : s.hi }))
  .sort((a, b) => a.lo - b.lo);
const seenSeasonIds = new Set();
for (const s of TIERS) {
  const roster = s.races || [];
  const bad = roster.concat(s.finale ? [s.finale] : []).filter((id) => !CAT_BY_ID[id]);
  const badScale = s.scale != null && (typeof s.scale !== 'number' || !(s.scale > 0));
  // **`payMult` is checked here and not defaulted**, and the reason is that a
  // missing one does not stop anything: points, gold and rating are all
  // multiplied by it, and a tier without it pays nothing at all - the Snail GP
  // paying the same as the Sunday Cup, with no error and nothing on the screen
  // saying so. A tier that forgets the key is a bug the ladder cannot see.
  const badPay = typeof s.payMult !== 'number' || !(s.payMult > 0);
  if (bad.length || !roster.length || badScale || badPay || typeof s.lo !== 'number' || !(s.hi > s.lo)) {
    if (IN_BROWSER) {
      document.getElementById('boot').textContent = `seasons.json: "${s.id || '?'}" needs a rating band, a positive scale, a positive payMult, and races that exist in races.json${bad.length ? ` (unknown: ${bad.join(', ')})` : ''}.`;
    }
    throw new Error('bad season ' + s.id);
  }

  /**
   * **One course of each trait, and a finale that is not one of them.**
   *
   * A cup with `power` twice and no `flying` in it is a season that works: four
   * courses get planned, four races get run, a purse is paid out of each, a result
   * is written against every one, and the card prints "tests power" on two lines
   * with **nothing anywhere saying a snail never once got to fly.** It is the
   * quietest thing in this file, because every number in it is right and the
   * ladder's own claim - a season is a rung up, and a rung is one step - is the
   * only thing that is false. It happened by accident and by the best route
   * available: four tiers, one ashlands course each, all four appended to the end
   * of the roster, and the one course nobody checked was the flying one.
   *
   * So the roster is asked a question it has to answer, at boot, by name.
   */
  const tally = new Map();
  const loose = [];
  for (const id of roster) {
    const t = CAT_BY_ID[id] && CAT_BY_ID[id].trait;
    if (!t) { loose.push(id); continue; }
    tally.set(t, (tally.get(t) || 0) + 1);
  }
  const missing = RACE_TRAITS.filter((t) => !tally.has(t));
  const twice = [...tally].filter(([, n]) => n > 1).map(([t]) => t);
  // **and the finale, which is the fifth course and not a fourth round.** It has
  // to be there (a cup with nothing closing it ends the moment the fourth race is
  // finished, with no summary and no button), it cannot be one of the four (the
  // same course twice on one card is two lines saying the same thing), and it
  // cannot name a trait (the card prints "every trait" for a traitless course, and
  // a finale that printed "tests flying" would be the one race in five that is
  // about nothing).
  const fin = s.finale ? CAT_BY_ID[s.finale] : null;
  const badFinale = !fin ? 'no finale' : roster.includes(s.finale) ? `${s.finale} is on the card twice`
    : fin.trait ? `${s.finale} tests ${fin.trait}` : null;
  if (missing.length || twice.length || loose.length || badFinale) {
    const why = [];
    if (missing.length) why.push(`no ${missing.join(', no ')}`);
    if (twice.length) why.push(`${twice.join(', ')} twice`);
    if (loose.length) why.push(`${loose.join(', ')} tests nothing`);
    if (badFinale) why.push(badFinale);
    if (IN_BROWSER) {
      document.getElementById('boot').textContent = `seasons.json: "${s.id || '?'}" — ${why.join('; ')}. A cup is one course of each of ${RACE_TRAITS.join(', ')}, and a finale that tests every trait.`;
    }
    throw new Error('bad season traits ' + s.id);
  }
  // two seasons with the same id would leave one of them unreachable: the
  // picker draws a season's seven by its id, and the last one would win
  if (seenSeasonIds.has(s.id)) {
    if (IN_BROWSER) {
      document.getElementById('boot').textContent = `seasons.json: two seasons are called "${s.id}". Give them each their own id.`;
    }
    throw new Error('duplicate season id ' + s.id);
  }
  seenSeasonIds.add(s.id);
}
const TIER_BY_ID = Object.fromEntries(TIERS.map((s) => [s.id, s]));
/** The seasons a rating is good enough for. Overlaps mean more than one. */
function eligibleSeasons(rating) {
  return TIERS.filter((t) => rating >= t.lo && rating < t.hi);
}
/** Can this snail go in? The bottom rung is always open, so nobody is stuck. */
function canEnter(id, rating) {
  const t = seasonDef(id);
  return rating >= t.lo && rating < t.hi;
}
/** The best season a rating earns, for a save or a new game that picks for you. */
function seasonFor(rating) {
  const ok = eligibleSeasons(rating);
  return ok.length ? ok[ok.length - 1] : TIERS[0];
}
/** The season you are racing. */
function seasonDef(id) { return TIER_BY_ID[id] || TIERS[0]; }
/** How long this season's courses are, as a multiple of races.json's own. */
function seasonScale(id) {
  const s = seasonDef(id);
  return typeof s.scale === 'number' && s.scale > 0 ? s.scale : 1;
}
/** The courses you get to pick the order of. */
function seasonPicks(id) { return seasonDef(id).races.slice(); }
/** The one that closes the season, whatever order you pick. */
function seasonFinaleId(id) { return seasonDef(id).finale || null; }
/** Every course in the season, in running order. */
function seasonRoster(id) {
  const f = seasonFinaleId(id);
  return f ? seasonPicks(id).concat([f]) : seasonPicks(id);
}

/* ================================================================== *
 * Faces and hats.
 *
 * **One table each, and that is the point.** `meshes/maps.js`'s header argues
 * that a fourth hand-kept list of prop names is how a library drifts, and the
 * wardrobe is exactly that list: the shop's prices, the shape of the rival
 * derivation and the names the loader has to find a glb under all have to agree,
 * and three copies of the same sixteen names is three chances not to. So the
 * shop reads `FACE_SET` / `HAT_SET`, the derivation reads `faceFor` / `hatFor`,
 * and `tools/plan-test.mjs --faces` reads the same two tables to prove every
 * name a rival can be given exists in one.
 *
 * `price: 0` is a starter the player begins with. **`locked: true` is the other
 * half of it** - `devil` and `devil-horns` have no price at all, because they
 * are not bought: they are the Adversary's, and they come off a duel. Nothing in
 * the derivation can hand them out, and `plan-test.mjs --faces` asserts it on
 * every one of the sixty-four.
 *
 * **A face is the whole face and a hat is a silhouette, and that is not a
 * detail of the art.** A snail's head is four centimetres across at race
 * distance and eight of them differ by a couple of degrees, so the fine read is
 * carried by the hats and the faces are there to be legible when you are close
 * to one. Ten faces is a crowd rather than a uniform.
 * ================================================================== */
const FACE_SET = [
  { name: 'plain', price: 0, rule: 'nothing else matched' },
  { name: 'cheer', price: 0, rule: 'greed in 0.35–0.65' },
  { name: 'dollar', price: 25, rule: 'greed >= 0.70' },
  { name: 'keen', price: 30, rule: 'skill >= 1.045' },
  { name: 'smug', price: 45, rule: 'greed <= 0.30 and rating >= 480' },
  { name: 'grim', price: 35, rule: 'rating <= 240' },
  { name: 'tidal', price: 40, rule: 'swimming is the best of the five' },
  { name: 'winged', price: 40, rule: 'flying is the best of the five' },
  { name: 'wild', price: 50, rule: 'jitter >= TAU * 0.875' },
  { name: 'googly', price: 35, rule: 'stamina is the best of the five' },
  { name: 'fangs', price: 45, rule: 'greed just above nothing, and rating above 240' },
  { name: 'grin', price: 30, rule: 'greed between smug and cheer - wants a little' },
  { name: 'crest', price: 40, rule: 'jitter between TAU * 0.70 and wild' },
  { name: 'devil', price: 0, locked: true, rule: 'the Adversary, and only them' },
];
const HAT_SET = [
  { name: 'none', price: 0, sentinel: true, rule: 'no file at all - a null hat is no mesh' },
  { name: 'straw', price: 0, rule: 'a wide brim, the classic' },
  { name: 'propeller', price: 50, rule: 'skill >= 1.045, and it turns' },
  { name: 'sunglasses', price: 45, rule: 'greed >= 0.70, and it sits on the eye line' },
  { name: 'bonnet', price: 55, rule: 'greed <= 0.30' },
  { name: 'top-hat', price: 60, rule: 'the id thirds it out, so every third snail wears one' },
  { name: 'wizard', price: 70, rule: 'the third of the pool the top hat misses, and it is the tall one' },
  { name: 'devil-horns', price: 0, locked: true, rule: 'the Adversary, and only them' },
];
const FACE_BY_NAME = Object.fromEntries(FACE_SET.map((f) => [f.name, f]));
const HAT_BY_NAME = Object.fromEntries(HAT_SET.map((h) => [h.name, h]));
/** The traits a snail is worst at, best at, and which is the best. */
const topAttr = (attrs) => {
  let key = null, hi = -Infinity;
  for (const a of ATTRS) if (attrs[a.key] > hi) { hi = attrs[a.key]; key = a.key; }
  return key;
};
/**
 * The face a snail wears, from what it is. **Top to bottom, first match wins,
 * and the order is load-bearing**: `keen` and `winged` both fire for a fast
 * flyer and the earlier row is the one that has to be above the later one, or
 * the reading of "this one is quick" would swallow "this one flies" and the
 * set would be eight faces with two of them unreachable.
 *
 * `plain` is the floor and the fallback, so a snail with nothing said about it
 * still has a face, and `devil` is **not** in here at all: it is a reward and a
 * derivation that could hand it out would put the Adversary's horns on the grid
 * of the Sunday Cup.
 */
function faceFor(sn) {
  const at = sn.attrs || {};
  const greed = sn.greed == null ? 0 : sn.greed;
  const skill = sn.skill == null ? 1 : sn.skill;
  const rating = sn.rating == null ? 0 : sn.rating;
  const jitter = sn.jitter == null ? 0 : sn.jitter;
  if (greed >= 0.70) return 'dollar';
  if (skill >= 1.045) return 'keen';
  if (greed <= 0.30 && rating >= 480) return 'smug';
  if (rating <= 240) return 'grim';
  if (topAttr(at) === 'swimming') return 'tidal';
  if (topAttr(at) === 'flying') return 'winged';
  /**
   * **And the three faces off a reference, and each is on a dimension no face above
   * was reading** - which is the only way a face can be added without taking a snail
   * off another one, and it is checked rather than hoped for: `plan-test.mjs --faces`
   * asserts every buyable face is reachable, so a branch placed above one of these
   * would fail the gate the moment the set grew.
   *
   * `stamina` is the dimension, and **it is the one attribute nothing in this function
   * looked at until now**: four of the five traits chose a face and the fifth went
   * round wearing whatever the other four left. `jitter` already had one reader, and
   * the band below `wild`'s was unclaimed. And `greed` has three, none of which is the
   * sliver between `smug`'s ceiling and `cheer`'s floor - **a snail that wants a little
   * and not much**, which is nobody.
   */
  if (topAttr(at) === 'stamina') return 'googly';
  if (jitter >= TAU * 0.70 && jitter < TAU * 0.80) return 'crest';
  if (jitter >= TAU * 0.875) return 'wild';
  /**
   * **And this one is last on purpose.** A chain of guards can only hand a snail to a
   * face that reads a dimension nothing above it reads, and **below the tenth branch
   * there are three faces left** - `wild`, `cheer` and `plain` - so a guard placed
   * anywhere else takes its snails off a face the gate insists is reachable and fails
   * the run. Placed here it has exactly the three of them to work with, and **the band
   * is narrow on purpose: at `TAU * 0.70` it took all four of the snails below this
   * line and left `plain` and `cheer` at nothing**, which is a set of thirteen faces in
   * which two of them never appear. **A face nobody wears is not a rare face, it is a
   * face that has gone quiet** - the same failure as `hatFor()` returning `none` for a
   * sixth of the pool, and it is the reason the band is `0.35`.
   *
   * `jitter` is the dimension, and it is what a snail's `jitter` is for: **how unsteady
   * it is**. So the steadiest snail on the ladder wears the face with a mouthful of
   * teeth, which is nobody's derivation and is exactly what a set of rules reading six
   * attributes and a rating ought to produce now and then.
   */
  if (jitter < TAU * 0.35) return 'fangs';
  /**
   * **And this one is the sliver the comment above already named.** `smug` takes
   * `greed <= 0.30` and `cheer` takes `greed >= 0.35`, so there is a band of five
   * hundredths between them that nothing read — **a snail that wants a little and not
   * much**, which was described as "nobody" when the chain was written and is in fact
   * precisely the snail a grin belongs to. It is placed here rather than above the
   * `jitter` guards because it shares no dimension with them, so nothing is lost
   * whichever order the two are in.
   */
  if (greed > 0.29 && greed < 0.35) return 'grin';
  if (greed >= 0.35 && greed <= 0.65) return 'cheer';
  return 'plain';
}
/**
 * The hat a snail wears, from what it is - and `id` is a third of the answer on
 * purpose. Greed buys the expensive pair, skill the aerodynamic one, and the
 * rest is `id` modding rather than an rng draw: **the same sixty-four rivals
 * wear the same hats in every season, for ever**, and a draw would make the
 * ladder's own cast shuffle around under a player who had not raced anybody.
 *
 * Roughly a third of the pool wears nothing, and that is deliberate: a hatless
 * snail is what makes a hat read as a hat when a hat is there at all.
 */
function hatFor(sn) {
  const greed = sn.greed == null ? 0 : sn.greed;
  const skill = sn.skill == null ? 1 : sn.skill;
  const id = ((sn.id | 0) % 3 + 3) % 3;
  if (greed >= 0.70) return 'sunglasses';
  if (skill >= 1.045) return 'propeller';
  if (greed <= 0.30) return 'bonnet';
  if (id === 0) return 'top-hat';
  if (id === 1) return 'straw';
  // **and the third of the pool wears a wizard hat rather than nothing**, which is the
  // `>= 4 hats reach the pool` check being answered rather than satisfied: the old answer
  // here was `none`, so **a sixth of the field raced bare-headed** and the set was one
  // hat short of the crowd the comment above `FACE_SET` says it is.
  return 'wizard';
}
/**
 * Write the two names onto every snail in a pool, and **add no draw.** Every
 * input is a number the rival already stores, so the field composition is
 * untouched and the dressing is a read of the pool rather than a second lottery
 * beside it. `load()` calls it too, which is what gives an old save its faces
 * without a version bump.
 */
function dressPool(pool) {
  for (const sn of pool) {
    if (!sn.face) sn.face = faceFor(sn);
    if (!sn.hat) sn.hat = hatFor(sn);
  }
  return pool;
}

/**
 * Both scales read off the same curve. A player's traits run 1 to STAT_MAX and
 * a rival's attributes 1 to ATTR_MAX, but the ends of each range are the same
 * snail, so a maxed player is exactly as quick as a maxed rival and there is
 * no reading of the sim that quietly favours one over the other.
 */
function effFor(v, lo, hi) { return 1 + ((v - lo) * (STAT_MAX - 1)) / (hi - 1); }
function effTraits(sn) {
  const lo = sn.player ? STAT_MIN : 1, hi = sn.player ? STAT_MAX : ATTR_MAX;
  const src = sn.player ? sn.stats : sn.attrs;
  const out = {};
  for (const a of ATTRS) out[a.key] = effFor(src[a.key], lo, hi);
  return out;
}

/* ================================================================== *
 * Random + noise. Everything is seeded, so a track looks the same
 * every time it is rebuilt and the season card can promise a course
 * before the player ever sees it.
 * ================================================================== */
function makeRng(seed) {
  let s = (seed | 0) || 1;
  return function () {
    s ^= s << 13; s |= 0; s ^= s >>> 17; s ^= s << 5; s |= 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}
const rand = makeRng(20260926);
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, oct = 3) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); norm += a; a *= 0.5; f *= 2.05; }
  return s / norm;
}
// the rolling countryside the lane is cut through
/** The seed a course is planned under: `4200 * 7`, the course's own index times 977,
 *  and the season times 131 - so two courses never share a line and the same
 *  course is a different line in a different season. **The season is an
 *  argument and not a read of `state`**, because the scenery is upstream of the
 *  race and cannot reach it; `world.seasonOf()` is the other end of that. */
const SEED_BASE = { v: 4200 };
const trackSeed = (catId, season) => SEED_BASE.v * 7
  + CATS.findIndex((c) => c.id === catId) * 977 + season * 131;
function hills(x, z) {
  // the two coarse octaves carry the shape; the fine one is kept small, or
  // the ground beside the lane breaks into hard little facets
  let h = 6.2 * (fbm(x * 0.0085, z * 0.0085, 3) - 0.5);
  h += 2.2 * (fbm(x * 0.026, z * 0.026, 2) - 0.5);
  h += 0.32 * (fbm(x * 0.105, z * 0.105, 2) - 0.5);
  h += Math.max(0, Math.abs(z) - 26) * 0.034;
  return h;
}

/* ================================================================== *
 * Geometry helpers, borrowed from the horse
 * ================================================================== */
/** Bake primitives into one vertex-coloured geometry (one draw call). */
function bake(parts) {
  let vc = 0, ic = 0;
  for (const p of parts) {
    vc += p.g.attributes.position.count;
    ic += p.g.index ? p.g.index.count : p.g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3);
  const idx = new Uint16Array(ic);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.g, n = g.attributes.position.count;
    nm.getNormalMatrix(p.m);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(p.m);
      pos.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize();
      nor.set([v.x, v.y, v.z], (vo + i) * 3);
      col.set(p.c, (vo + i) * 3);
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rz = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
function colored(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.setRGB(1, 1, 1);
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c, i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// ------------------------------------------------------------------
// The names the other ten modules import, and the list is the map of the
// graph. **`$` is in it because the boot screen is written from four places
// and three of them are in here**, and `seasonLength()` is *not*, because it
// is the one function this range owns that reads `state` - and `state` is the
// race's. It counts races for a label and all three of its callers are HUD, so
// it went the other way and it lives with the thing it counts.
// ------------------------------------------------------------------
export {
  THREE, $, TAU, clamp, lerp, smoothstep, easeInOut,
  CATS, CAT_BY_ID,
  RUN, CLIMB, SWIM, FLY, WALK, PUSH, BOWER,
  CLIMB_GRADE, LANE_HW,
  CRATE_S, CRATE_X, CRATE_BACK, CRATE_GAP, CRATE_LANE, CRATE_HW, CRATE_FLARE, CRATE_WALL,
  HOURS_PER_SECOND, LEVEL_Y, POOL_BANK, POOL_SPREAD, POOL_BERM, COND, ATTRS, ELEMENTS,
  STAT_MAX, STAT_MIN, GOLD_PER_FRUIT, START_GOLD, START_RATING, POINTS, FIELD, POOL_SIZE,
  CLUB_SNAILS, CLUB_ATTR, ATTR_MAX, RATING_SCALE, RATING_POW, RATING_GAIN, PODIUM_FLOOR,
  RATING_MIN, RATING_MAX, RATING_STEP, ratingOf,
  SURGE_MULT, SURGE_DRAIN, PASSIVE_DRAIN, TIRED_MULT, SWIM_Y, REGEN, STEP, START_S, freshSnail,
  seasonWord, TIERS, TIER_BY_ID, eligibleSeasons, canEnter, seasonFor, seasonDef,
  seasonScale, seasonPicks, seasonFinaleId, seasonRoster, effFor, effTraits,
  FACE_SET, HAT_SET, FACE_BY_NAME, HAT_BY_NAME, faceFor, hatFor, dressPool, topAttr,
  BIOMES, ROLE_KEYS, SET_ROLES, PAL_KEYS,
  trackSeed, makeRng, rand, vnoise, fbm, hills,
  bake, M, colored,
};
