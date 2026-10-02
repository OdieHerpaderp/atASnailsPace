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

let THREE;
try {
  THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
} catch (err) {
  document.getElementById('boot').textContent = 'Could not load three.js from the CDN — connect and reload.';
  throw err;
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
async function loadData(file, what) {
  let res;
  try {
    res = await fetch(file);
  } catch (err) {
    document.getElementById('boot').textContent = `Could not load ${file} — is it being served next to the page?`;
    throw err;
  }
  if (!res.ok) {
    document.getElementById('boot').textContent = `Could not load ${file} (${res.status}).`;
    throw new Error(file + ' ' + res.status);
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    document.getElementById('boot').textContent = `${file} did not contain a list of ${what}.`;
    throw new Error(file + ' is not a list of ' + what);
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
    document.getElementById('boot').textContent = `races.json: "${c.id || '?'}" needs a positive len and scale.`;
    throw new Error('bad course ' + c.id);
  }
  // the length the course is actually laid out to
  c.len = c.len * c.scale;
}
const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));
/* ================================================================== *
 * Tuning
 * ================================================================== */
const RUN = 0, CLIMB = 1, SWIM = 2, FLY = 3, WALK = 4, PUSH = 5;
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
};
for (const c of CATS) {
  const unknown = (c.pool || []).filter((k) => !ELEMENTS[k]);
  const missing = (c.pool || []).filter((k) => (NEEDS[k] || []).some((f) => !Array.isArray(c[f])));
  // every element a course names is dealt into the course at least once, so
  // it needs room for all of them
  const tooMany = Array.isArray(c.pool) && new Set(c.pool).size > c.feats;
  if (!Array.isArray(c.pool) || !c.pool.length || unknown.length || missing.length || tooMany) {
    document.getElementById('boot').textContent =
      `races.json: "${c.id || '?'}" needs a pool of known elements` +
      (unknown.length ? ` (unknown: ${[...new Set(unknown)].join(', ')})` : '') +
      (missing.length ? `, and for the rest: ${[...new Set(missing)].map((k) => NEEDS[k].join('/')).join(', ')}` : '') +
      (tooMany ? `, and at least ${new Set(c.pool).size} feats for the ${new Set(c.pool).size} different elements it names` : '') + '.';
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
const ATTR_MAX = 16;                        // a rival's attributes run 1 to 32
const RATING_PER_ATTR = 10;                  // so a total of 160 is a rating of 1280
const START_RATING = 10;                    // where the player starts on the ladder
const RATING_EASE = 0.25;                   // how much of the way to its target one race moves a rating
const RATING_STEP = 15;                    // and the most it can move in a single race, either way
const RATING_PER_WIN = 2;                  // and what a race's points are worth, which sets the top of the ladder
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
  if (bad.length || !roster.length || badScale || typeof s.lo !== 'number' || !(s.hi > s.lo)) {
    document.getElementById('boot').textContent = `seasons.json: "${s.id || '?'}" needs a rating band, a positive scale, and races that exist in races.json${bad.length ? ` (unknown: ${bad.join(', ')})` : ''}.`;
    throw new Error('bad season ' + s.id);
  }
  // two seasons with the same id would leave one of them unreachable: the
  // picker draws a season's seven by its id, and the last one would win
  if (seenSeasonIds.has(s.id)) {
    document.getElementById('boot').textContent = `seasons.json: two seasons are called "${s.id}". Give them each their own id.`;
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
  RUN, CLIMB, SWIM, FLY, WALK, PUSH,
  CLIMB_GRADE, LANE_HW,
  CRATE_S, CRATE_X, CRATE_BACK, CRATE_GAP, CRATE_LANE, CRATE_HW, CRATE_FLARE, CRATE_WALL,
  HOURS_PER_SECOND, LEVEL_Y, POOL_BANK, POOL_SPREAD, POOL_BERM, COND, ATTRS, ELEMENTS,
  STAT_MAX, STAT_MIN, GOLD_PER_FRUIT, START_GOLD, START_RATING, POINTS, FIELD, POOL_SIZE,
  CLUB_SNAILS, CLUB_ATTR, ATTR_MAX, RATING_PER_ATTR, RATING_EASE, RATING_STEP, RATING_PER_WIN,
  SURGE_MULT, SURGE_DRAIN, PASSIVE_DRAIN, TIRED_MULT, SWIM_Y, REGEN, STEP, START_S, freshSnail,
  seasonWord, TIERS, TIER_BY_ID, eligibleSeasons, canEnter, seasonFor, seasonDef,
  seasonScale, seasonPicks, seasonFinaleId, seasonRoster, effFor, effTraits,
  makeRng, rand, vnoise, fbm, hills,
  bake, M, colored,
};
