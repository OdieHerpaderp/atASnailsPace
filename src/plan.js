/* ================================================================== *
 * plan.js
 *
 * The course planner, and nothing else at all. A course is a list of sections
 * laid end to end, the section list becomes control points in a design
 * coordinate, and that line is the only thing this file produces: no samples, no
 * frames, no ground, no road. Everything downstream reads `plan.pts`,
 * `plan.meta` and `plan.leaps` and builds a world out of them, and a file that
 * had a second job in it is a file where the second job's ordering is
 * somebody's memory.
 *
 * **It is a file of its own and not a section of a larger one, and the reason is
 * one line of code.** `planTrack()` pushes a design point per sample and the
 * planner itself never calls a method on one - it reads `.x`, writes `.y` and
 * compares `.x` - so a point is `{x, y, z}` and **this module imports no
 * three.js at all**, which is what turns `tools/plan-test.mjs` from a text
 * scraper with a hand-written `Vector3` shim into an import and makes the node
 * check a check of the planner rather than of a re-typed copy of it.
 *
 * **The conversion it used to need is at the boundary and not here, and it
 * moved there against an argument.** A `CatmullRomCurve3` with `centripetal`
 * parameterisation does not merely read components off the points it is given:
 * it takes `p1 = points[i]` and calls `p1.distanceToSquared(p2)` to weight the
 * span, so a plain object comes back as
 * `p1.distanceToSquared is not a function` on the first point of the first
 * course. So `buildTrack()` maps the plan into real vectors on the way in - one
 * line, in `course.js` - and the planner keeps the shape it has always had.
 * Which is the better place for it: a module that a node process can import is
 * worth one line at a boundary.
 *
 * `core.js` leaves `THREE` as `null` when there is no `document`, so a planner
 * that reached for it would throw rather than need a shim, and
 * `tools/plan-test.mjs` is that node process.
 *
 * `inHole()` and `smoothRidges()` are in here rather than in `course.js`, where
 * the file's line ranges would have put them: `planTrack()` calls both, and a
 * planner that imported its own ridge filter from a module that imports the
 * planner is a cycle wearing a module boundary.
 * ================================================================== */
import {
  CAT_BY_ID, ELEMENTS, TAU, makeRng, clamp, lerp, smoothstep, easeInOut, hills,
  LEVEL_Y, POOL_BANK, POOL_SPREAD, POOL_BERM, LANE_HW, CRATE_X, CRATE_LANE,
  RUN, CLIMB, FLY, WALK, PUSH,
} from './core.js';

/* ================================================================== *
 * Track planning. A course is a list of sections laid end to end; the
 * section list is turned into control points, the control points into a
 * spline, and the spline is resampled by arc length so distance along
 * the course is simply a number the racers carry.
 * ================================================================== */

/**
 * The half-way sweep, and the two numbers it is made of.
 *
 * Every course carries a tower at its half-way mark and the lane goes round it,
 * so that the tower is something you race **past** rather than something that
 * happens to be beside the road for a quarter of a second. `MID_SPAN` is how
 * far along the course the sweep runs either side of the tower, and
 * `MID_CROWN` is how far round it the lane is at its nearest - the crown's
 * radius of curvature, which is the same number seen from the other end.
 *
 * They are one relationship and not two choices. The bump is `(1-t^2)^3`, whose
 * curvature at the crown is `6A / MID_SPAN^2` for a sweep `A` deep, and the
 * centre of that curvature - the point the road is genuinely circling, and the
 * only place a tower can stand and be circled - sits `MID_SPAN^2 / 6A` back
 * from the lane. So asking for a fifteen-metre crown asks for a sweep of
 * `MID_SPAN^2 / (6 * 15)`, and the two numbers cannot disagree about it.
 *
 * Fifteen is the distance because of the two things it has to be. It is the
 * crown's radius, and a course that already runs a hundred metres of bend from
 * `corners` and `wiggle` is spending its curvature budget before the sweep
 * arrives; fifteen puts the tightest part of it at `k = 0.067`, which is past
 * the point where the sim stops slowing anybody down, so the landmark costs
 * the race nothing. And it is the clearance: the tower's buttresses stand four
 * and a half metres out, so the lane is ten and a half metres from the nearest
 * stone at its closest, and the ground the tower stands on is ground the sweep
 * has already had built.
 *
 * **And fifteen is the crown on a course that runs on the level, which a
 * climbing course cannot afford.** Swinging the lane eleven metres to the side
 * swings its *verge* eleven metres too, because the verge is built off the
 * lane: `groundYAt()`'s wall profile lays a shelf at the lane's own level and
 * then a **plane** for a face a third of the drop wide, so a lane three metres
 * above the country has a three-metre step along its whole length, and moving
 * it eleven metres moves that step eleven metres through the hillside. On Crag
 * Ascent, whose lane has climbed five walls and stands about three metres above
 * the meadow by its half-way, the far end of the sweep left a shelf of turf
 * hanging out over the drop with its underside on show - the overhang, and it is
 * the sweep's, because the same sweep on Hedgerow Dash, whose lane is six
 * centimetres above the country, is invisible.
 *
 * So the crown **gives way to the climbing**. What decides it is the course's
 * own climb budget - the mean height of its walls times the number it deals -
 * and that is the one number that says whether a lane will be standing off the
 * country, because the lift a course accumulates *is* its walls. It is also the
 * right shape of answer: it is known before the course is laid out, it is the
 * same for every point on it, and so the sweep's depth cannot step along the
 * course. (An earlier version read the drop per point off the lane's own level,
 * and that level **steps by the height of every wall**, so a depth that stepped
 * made a sweep that stepped and a lane that stepped is a kink - it put a
 * one-metre radius into the Grand Prix course where the sweep crossed a wall.)
 *
 * A deeper crown is a wider arc and not a weaker one: the lane still circles the
 * tower at `C` metres, the tower just stands further off for it, which is also
 * the better building site - the ground under a lane that is perched on a drop
 * is the bottom of a face, and a tower on the bottom of a face is a tower in a
 * ditch. A meadow course gets exactly the fifteen metres it always had.
 */
const MID_SPAN = 32;
const MID_CROWN = 15;
/** **The length below which a course is not bent at all.** The sweep is
 *  `2 * MID_SPAN` of bend, and a course has to be long enough to hold it without
 *  the bend being most of the course: Crag Ascent lays out about eighty-five
 *  metres, so sixty-four of bend is three-quarters of the race, and the lane is
 *  not a road with a landmark beside it any more - it is one long arc with a
 *  tower somewhere on it and no straight anywhere to race down. It is also the
 *  reason the ground could not be laid out flat there, because a ribbon that
 *  wide cannot follow a curve that tight without its inside rows crossing.
 *
 *  So below this a course is **not swept**. Not bent a little: the sweep is a
 *  thing that is either there or not, and a third of one is just a wobble in
 *  the middle of the course. `midCrown()` falls back to the plain fifteen and
 *  the tower stands its own distance off the road, which is all it needs - the
 *  sweep is a bonus, and a course too short to afford it is better off without.
 *  Marathon is long enough to keep it; the four short ones are not.
 */
const MID_MIN = 130;
/** How much of the footpath in front of a wall is left, the rest of it being
 *  moved to the run-out - so the walls come closer together and the course
 *  still comes out the length its category promises. */
const CLIMB_PACK = 0.45;
/** How much of the course either side of its exact middle is kept clear of
 *  features, and the floor on the run-in that pays for it.
 *
 *  A **fraction** of the course and not a number, and it is a fraction because
 *  thirty-two metres is a third of Crag Ascent. A fixed band that generous on
 *  the Grand Prix course is absurd and on an eighty-metre climbing course it
 *  eats everything there is to eat: the last two walls ended up past the
 *  finish line, with the lane stopping dead at the gate and the country
 *  running on behind it. One tenth, floored at ten metres and capped at
 *  twenty-four, is a fifth to a quarter of any course - enough that the
 *  checkpoint's line, the gate either side of it and the tower's own ground can
 *  all see each other over nothing, and short enough that there is still a
 *  course. */
const MID_BAND = 0.15;
const BAND_MIN = 13;
const BAND_MAX = 28;
/** And the share of it the **finish** gets rather than the middle. The middle
 *  is the landmark and the thing a course is built around; the finish is a line
 *  and a run-out. Lily Deep is where the difference shows: four pools at fifteen
 *  metres each are two thirds of a Sunday Cup course, so the flat ground the
 *  checkpoint is put on has to be bought from the run-out rather than found.
 *  The two bands cost the same together either way, so this is who gets it. */
const BAND_FINISH = 0.45;
const RUN_IN_MIN = 12;
const RUN_OUT_MIN = 18;
/** The drop at which the sweep has given all the ground it gives, and what it
 *  buys with it: metres of crown per metre of height difference. */
const MID_DROP_MAX = 4;
const MID_CROWN_YIELD = 1.6;
const midCrown = (drop) => MID_CROWN + MID_CROWN_YIELD * clamp(drop, 0, MID_DROP_MAX);
/** The sweep itself, and the crown it is cutting - which is a number, not a
 *  lookup, so the bend and the tower's distance from the road cannot come out
 *  of step. Outside the span the sweep is nothing at all, and in the middle it
 *  is flat to the second derivative in `t`, which is what keeps the curvature -
 *  and so the tower's own distance from the road - even across the middle of the
 *  sweep instead of peaking at the tower itself.
 *
 *  A crown of zero is a course too short to sweep at all, and the bump divides
 *  by it, so the zero is caught here rather than a third of a wobble being
 *  drawn down the middle of a race. */
const midSweep = (x, at, crown) => {
  if (crown <= 0) return 0;
  const t = (x - at) / MID_SPAN;
  return t <= -1 || t >= 1 ? 0 : (1 - t * t) ** 3 * MID_SPAN * MID_SPAN / (6 * crown);
};

function planTrack(catId, seed, lenScale) {
  const cat = CAT_BY_ID[catId];
  // A season can ask for a longer or shorter course than the one in
  // races.json. The features keep the size they are drawn at - a wall is as
  // high and a gap as wide whatever season you are racing - and the footpath
  // between them stretches or shrinks, so a Grand Prix course is the same
  // walls and chasms with a great deal more country in between.
  const len = cat.len * (lenScale > 0 ? lenScale : 1);
  const W = LANE_HW;               // half-width of the lane: eight abreast
  const R = makeRng(seed);
  const p1 = R() * TAU, p2 = R() * TAU;
  const lateral = (x) =>
    cat.wiggle[0] * Math.sin(x * cat.wiggle[1] + p1) +
    cat.wiggle[2] * Math.sin(x * cat.wiggle[3] + p2);

  // corners: eased sideways shifts, held once made, so the lane snaps
  // round a bend and then runs straight again
  const corners = [];
  let drift = 0;
  for (let x0 = 16; x0 < len + 24; ) {
    const len = cat.corners[0] + R() * (cat.corners[1] - cat.corners[0]);
    let amp = (R() < 0.5 ? -1 : 1) * (2.0 + R() * 3.0);
    if (Math.abs(drift + amp) > 9) amp = -Math.sign(drift) * (1.6 + R() * 2.2);
    drift += amp;
    corners.push([x0, x0 + len, amp]);
    x0 += len + 10 + R() * 26;
  }
  const shift = (x) => {
    let s = 0;
    for (const c of corners) if (x > c[0]) s += c[2] * smoothstep(c[0], c[1], x);
    return s;
  };
  // ...and the half-way sweep, which is the same trick run once and hard.
  //
  // The tower stands at the half-way mark in the middle of the course, and a
  // landmark nobody can see is a landmark that is not there, so the lane is
  // made to go **round** it. A lateral offset is all a course can do about its
  // own shape - `cross(x)` is one value for each `x` along it, so this cannot
  // be a loop and is a sweep: the road swings out to one side, comes back past
  // the front of the tower, and swings out again on the far side, which puts
  // about a hundred and twenty degrees of turning through it and keeps a
  // seventeen-metre tower in frame for a good part of a lap instead of the
  // quarter of a second a straight road gives you.
  //
  // The three numbers are one relationship and not three choices. The bump is
  // `(1 - t^2)^3`, which is **flat at both ends to the second derivative**, so
  // the sweep fades into the course's own line without a crease in it - and
  // flat at the *crown* as well, which is the half of that matters most: a
  // bell that peaked sharply would put its highest curvature exactly where the
  // tower is, and the tower is the one piece of ground the sweep has to be
  // flat at. A bump's curvature at its crown is `6A / span^2`, and the crown's
  // **centre of curvature** - the point the road is genuinely going round, and
  // so the one place the tower can stand and be circled - is `span^2 / 6A`
  // back from the lane along the crown's own normal. So `MID_CROWN` is not a
  // free number: it is that distance, and the sweep's depth is whatever it
  // takes to produce it.
  //
  // The crown is this course's own at each point, scaled by how far the lane is
  // standing off the country there, and smoothed over the width of the sweep so
  // that it cannot step. It is settled below, once the section list is whole.
  const cross = (x) => lateral(x) + shift(x) + midSweep(x, len * 0.5, crown(x));
  // The height the lane runs at, before any wall has lifted it. By default it
  // rolls gently along the course. A course can ask for it level instead -
  // `level: true` in races.json, or `level: 1.4` to run at a set height - which
  // is what a swimming course wants: the water in every pool is then at the
  // same level and reads as level, instead of each pond sitting a metre lower
  // than the last down a slope. The country beside the lane still rolls, since
  // that is the hills rather than the lane, so a level course is a track cut
  // level through the meadow and not a flat world.
  const baseY = cat.level == null
    ? (x) => 2.6 * Math.sin(x * 0.0122 + p1 * 0.6) + 1.0 * Math.sin(x * 0.0285 + p2)
    : () => (typeof cat.level === 'number' ? cat.level : LEVEL_Y);

  // The section list: a run-in, then feature after feature, each one
  // reached along a stretch of footpath. The water features are the only
  // way past whatever they are - a leap is crossed in the air, a pool is
  // swum - so it is still the flying and swimming traits that decide them.
  // A long run-in and a long run-out. The grid sits far enough in for the
  // camera to have a start line to stand behind, and the finish far enough
  // out for the camera to get past it and watch the race come in, so neither
  // end of the course is ever looking off into nothing.
  const secs = [{ c: 'run', len: 17 + R() * 4 }];
  const tally = { walls: 0, leaps: 0, pools: 0, floods: 0, crates: 0, straights: 0 };
  // Every element the course names is dealt in at least once, and the rest of
  // the features are picked at random. Picking all of them at random meant a
  // course could come out with none of the thing it is named after - Lily
  // Deep drawing four leaps and no water at all - and because the seed is
  // fixed per course, the same course came out the same empty season after
  // season. This is the course's promise, so it is dealt, not gambled on.
  const kinds = [...new Set(cat.pool)].slice(0, cat.feats);
  while (kinds.length < cat.feats) kinds.push(cat.pool[(R() * cat.pool.length) | 0]);
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = (R() * (i + 1)) | 0;
    const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t;
  }
  for (const k of kinds) {
    if (k === 'climb') tally.walls++;
    else if (k === 'leap') tally.leaps++;
    else if (k === 'water') tally.pools++;
    else if (k === 'leapClimb') tally.floods++;
    else if (k === 'pushCrate') tally.crates++;
    else tally.straights++;
  }
  // the clear stretches of the course, and they are paid for out of the length
  // the course would otherwise have - see the note at the band below
  const band = clamp(len * MID_BAND, BAND_MIN, BAND_MAX);
  // **and the flat run home, which is the smaller of the two** - see `BAND_FINISH`
  const home = Math.max(6, band * BAND_FINISH);
  const clear = band + home;
  // the footpaths between features are sized so the course comes out near
  // the length its category promises
  // a wall is short and steep, so it eats far less of the course than it used
  // to; a climbing course has to stack more of them to still be about climbing
  const featX = kinds.reduce((a, k) => a + (ELEMENTS[k] || ELEMENTS.run).x, 0);
  // **and the band's width comes out of the footpaths**, spread across all of
  // them, so that the course still comes out the length its category promises
  // with the clear middle in it. The two ends give a little of it as well -
  // the run-in can spare a few metres and so can the run-out - but they cannot
  // spare the lot, and pretending otherwise is what made every course on the
  // calendar a third longer the moment the band went in: Lilypool went from a
  // hundred and forty-five metres to two hundred and nineteen.
  const conn = Math.max(2.6, (len - 24 - featX - clear * 0.72 - 0.8) / cat.feats);
  // **Walls closer together.** A climbing course's problem is not how much it
  // climbs, it is how long it spends *between* the climbs - and every metre of
  // footpath between two walls is a metre of lane lying along the country at a
  // height the country is not at, which is a mile of verge drawn in a lift. So
  // the footpath in front of a wall is cut to a fraction of the others, and the
  // length that comes off is given back in the run-out at the end, which is
  // flat road at the foot of the course where the lift is not a thing. The
  // course comes out the same length either way; it is just all in one place
  // instead of spread down the whole valley.
  // **The middle of the course is kept clear of features**, and it is the run-in
  // and the run-out that pay for it. On Crag Ascent the walls run from
  // twenty-four metres to sixty-one, which is most of the race in one climb, and
  // the half-way mark - the exact middle, fifty metres in - fell **nine hundred
  // millimetres** from the top of a wall. So the tower stood in the middle of a
  // climb with a wall on each side of it, which is the one place on a course
  // where the ground is a face and there is nothing flat to stand a building on,
  // and it did not read as the middle of anything.
  //
  // The band goes **between two features rather than through one**, and that is
  // the whole of how it is done: the deal is split where the middle of the course
  // falls, the stretch of plain lane is put between the two halves, and the
  // length of it comes out of the two ends. Moving a feature out of the middle
  // instead - which is the obvious way - shoves every feature after it along
  // with it, and on a short course they do not all fit: Crag Ascent's five walls
  // are already stacked three metres apart, and a band pushed in front of them
  // runs the last one off the end of the course and leaves the half-way mark
  // sitting in a climb again, which is the thing it was for.
  //
  // The run-in and the run-out are the only stretches that can afford it: the
  // grid sits far enough in and the finish far enough out for the camera to see
  // past either, and neither is a thing the race is about.
  // **Where the middle is, by counting the obstacles and not by measuring the
  // course.** The band goes after the first half of the deal: four pools and it
  // goes between the second and the third, five walls between the second and the
  // third, and that is the whole rule.
  //
  // It used to be worked out by walking the deal until the plan's `x` passed its
  // own middle, which is a length and not a count, and on a course whose pools
  // are long and whose footpaths are short the two disagree badly: Lilypool's
  // band landed after the **first** pool, because the run-in and the first pool
  // together are more than half the plan's length before the course has had a
  // chance to even out. The tower then stood beside the first water, and the
  // gap between the second and third - which is the middle of the course and
  // about twenty metres of nothing - went to waste. Counting cannot drift like
  // that: the middle of four things is between the second and the third whatever
  // their sizes are, and a wall is a wall and a pool is a pool.
  const cut = Math.floor(kinds.length / 2);
  let packed = 0;
  // **One feature each, once.** The two halves are slices of the same deal and
  // the second starts where the first stopped - laying the whole list and then
  // laying the tail of it again puts every feature after the band on the course
  // twice, which is not a subtle mistake: it made Lilypool a hundred and
  // ninety-six metres long when it is a hundred and forty-five.
  let atX = secs[0].len;
  const lay = (list) => {
    for (const k of list) {
      const footpath = (conn * 0.8) + R() * 0.7;
      // **A crate's footpath is floored, and a wall's is cut.** Both are the
      // same bargain: a `climb` is packed to a fraction of the others because a
      // climbing course's problem is how much lane it spends *between* the
      // climbs, and a `pushCrate` is floored at `CRATE_LANE` because the crate
      // is three and a half metres long and starts a metre and a half back from
      // the lip - on a course where walls stand three metres apart the footpaths
      // are already at their own 2.6 m floor, and a crate that is not given the
      // room is shoved off the end of its footpath into the wall behind it.
      // Either way the length that comes off is the run-out's to pay, and the
      // course comes out the length its category promises.
      const run = k === 'climb' ? footpath * CLIMB_PACK
        : k === 'pushCrate' ? Math.max(CRATE_LANE, footpath)
          : footpath;
      packed += footpath - run;
      // on the dash course the "features" are the straights themselves
      const feat = k === 'run' ? 10 + R() * 6 : 0;
      secs.push({ c: 'run', len: run });
      secs.push({ c: k, len: feat });
      atX += run + (k === 'run' ? feat : (ELEMENTS[k] || ELEMENTS.run).x);
    }
  };
  lay(kinds.slice(0, cut));
  // and the plain middle itself, which is the one stretch of a course with
  // nothing in it on purpose
  // **and where it is, which the checkpoint is then told.** The band and the
  // half-way mark used to be two independent middles - this one in the plan's
  // `x`, that one at the middle of the raced distance - and they are not the
  // same place, because a plan's `x` is not its arc length. On Lily Deep they
  // were four pools apart: the clear lane went into the wide gap between the
  // first and second pool and the tower stood in the next gap along, on ground
  // the band had already been spent protecting elsewhere. Nothing in a course
  // should have to know two different middles, so the band says where it is and
  // the checkpoint asks.
  //
  // **And centred in the gap, not pushed up against the obstacle before it.**
  // The footpath that separates one feature from the next belongs *between*
  // them, so half of it is laid in front of the band and half behind. Without
  // that the band began the instant the previous pool ended and all the
  // remaining road was after it, which put the checkpoint against the water it
  // was supposed to be standing between - the tower and the line on the same
  // stretch of course, both of them hard up against the near pool and twenty
  // metres of clear road on the far side of it. The band is the middle of the
  // course, so it is put in the middle of the gap.
  const half = conn * 0.4;
  secs.push({ c: 'run', len: half });
  atX += half;
  const midX = atX + band * 0.5;
  secs.push({ c: 'run', len: band });
  atX += band;
  secs.push({ c: 'run', len: half });
  lay(kinds.slice(cut));
  // **and the flat run home**, after the last feature rather than before it, so
  // the last wall on the course is behind the racer and not under them
  secs.push({ c: 'run', len: home });
  // the two ends give up what the clear stretches took, the run-in never below
  // what the grid and the camera behind it need, and the run-out never below the
  // finish camera needs to see the race come in
  const inCost = Math.min(Math.max(0, secs[0].len - RUN_IN_MIN), clear * 0.14);
  secs[0].len -= inCost;
  secs.push({ c: 'run', len: Math.max(RUN_OUT_MIN, 22 + R() * 5 + packed - (clear - inCost)) });

  // **How far the lane is standing off the country, along the course** - the
  // height difference the sweep is scaled by. It is built here, off the section
  // list, because the section list is the last thing that is finished before a
  // single point is laid down and `cross()` needs the number from the first one.
  //
  // The lift is the running total of the walls already climbed, and it is taken
  // at each section's **mean** height rather than the height it was actually
  // drawn at: the drawn heights come out of the random stream as the loop walks,
  // and asking the stream twice gives two different courses. The mean is the
  // right answer anyway, because what the sweep is answering is "how mountainous
  // is this course", and a course is mountainous whichever way its walls fell.
  //
  // The result is then **smoothed over the width of the sweep**, and that is not
  // a nicety. Read raw, the drop steps by the height of every wall, and a sweep
  // whose depth steps is a lane whose lateral offset steps, which is a kink - it
  // put a one-metre radius into the Grand Prix course at every wall. Averaged
  // across the span the bump is cut in, the number it is scaled by moves slowly
  // enough that the bump still reads as a bump, and no wall can put a corner in
  // the road.
  const lift = (() => {
    const at = [];
    let acc = 0, sx = 0;
    for (const sec of secs) {
      const h = sec.c === 'climb' ? (cat.climb[0] + cat.climb[1]) / 2 : 0;
      const w = sec.c === 'climb' ? (cat.climbRun[0] + cat.climbRun[1]) / 2 : sec.len;
      at.push([sx, sx + w, acc, acc + h]);
      acc += h;
      sx += w;
    }
    return (x) => {
      let lo = 0, hi = at.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (at[m][1] < x) lo = m + 1; else hi = m; }
      const s = at[lo];
      return lerp(s[2], s[3], clamp((x - s[0]) / Math.max(0.1, s[1] - s[0]), 0, 1));
    };
  })();
  const rawDrop = (x) => Math.abs(baseY(x) + lift(x) - hills(x, lateral(x) + shift(x)));
  // the smoothing window, sampled as a straight mean over the span either side
  const dropAt = (() => {
    const STEPS = 24;
    return (x) => {
      let sum = 0;
      for (let i = 0; i <= STEPS; i++) sum += rawDrop(x - MID_SPAN + (2 * MID_SPAN * i) / STEPS);
      return sum / (STEPS + 1);
    };
  })();
  const crownAt = (x) => midCrown(dropAt(x));
  // and the crown the sweep is cut to at each point, which is only a name for
  // it once the profile above exists - and **zero** on a course too short to
  // sweep, which is what stops the bend being drawn at all
  const crown = (x) => (len < MID_MIN ? 0 : crownAt(x));

  const pts = [], meta = [], leaps = [];
  // how far the course has been lifted by the walls it has already climbed
  let x = 0, y = 0, carry = 0;
  const push = (px, py, cond, ground, w, opt) => {
    // A junction between two elements is **one** point, not two. Each element
    // lays down its own curve and runs to its own end, and the sample the last
    // of them finishes on is the sample the next one starts on - so without
    // this the plan carries two samples at the same x, which is a zero-length
    // segment in the polygon, which a Catmull-Rom renders as a cusp.
    //
    // And a cusp is not a small thing. It measured a **0.1 m** radius - the
    // lane is five and a half metres wide - and there is one at the top and the
    // foot of every wall on every course, which is where the zigzag along the
    // edge of the country was coming from. The curve is supposed to be smooth
    // and it was being asked to pass through a point that doubled back on
    // itself; no amount of smoothing downstream can fix a doubled-back point,
    // because the thing to smooth is not smooth anywhere.
    const last = pts[pts.length - 1];
    if (last !== undefined && Math.abs(last.x - px) < 0.02) return;
    // **A plain object and not a `THREE.Vector3`, and this line is the reason
    // this module has no three.js in it.** `buildTrack()` hands this list to a
    // `CatmullRomCurve3` and takes the points back out, and the planner itself
    // never calls a method on one - it reads `.x`, writes `.y`, and compares
    // `.x` - so the plan's own shape carries no vector in it. The conversion
    // lives at that boundary instead, in `course.js`, one line wide.
    //
    // It was `new THREE.Vector3(px, py, cross(px))`, and putting it back here
    // would work and would cost this file its import. It is here because
    // `tools/plan-test.mjs` runs the planner in node, and node has no
    // `THREE`: the module has to evaluate with nothing from a CDN in it.
    pts.push({ x: px, y: py, z: cross(px) });
    // and the crown travels with the point, because the tower has to stand on
    // the centre of curvature of the sweep that was actually cut here - read it
    // back off the track rather than worked out again from a number that has
    // moved since
    meta.push(Object.assign({ cond, ground, w, water: null, floor: py, basin: 0, crown: crown(px) || MID_CROWN }, opt || {}));
  };
  // A steep ramp lofted off the hillside: `ground` stays down at the terrain
  // level, so the ramp reads as a solid wall rather than a hillside.
  // A ramp with two faces. A terrace holds its ground down at the foot, so
  // what stands beside the lane is a sheer face and the lane goes up it; a
  // slope carries its ground up with it, so it is a hill to run at.
  //
  // And it **tapers** if it is asked to, because a ramp that changes the width
  // of the lane in one sample is a pair of steps in the middle of a road. The
  // ramp up to the lip of a leap is the steepest thing on a course and the last
  // stretch of road before it, and a snail taking off from a lane that pinched
  // from five and a half metres to four and a half a metre earlier is leaving a
  // gate rather than a road, and the pinch reads on screen as a choke point
  // where there is no reason for one. So `wEnd` walks the width down over the
  // ramp's own length and a narrow lip is something the lane arrives at rather
  // than something it trips over.
  const ramp = (x0, y0, rise, run, cond = CLIMB, terrace = true, w = W * 0.78, wEnd = w) => {
    const steps = Math.max(3, Math.round(run / 0.4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const py = y0 + rise * (0.5 - 0.5 * Math.cos(Math.PI * Math.pow(t, 0.86)));
      // eased like the height is, so the shoulders come in as a curve and not
      // as a pair of chamfers either side of a straight
      push(x0 + run * t, py, cond, terrace ? y0 : py, lerp(w, wEnd, smoothstep(0, 1, t)));
    }
    return x0 + run;
  };
  for (const sec of secs) {
    if (sec.c === 'run') {
      const steps = Math.max(1, Math.round(sec.len / 1.1));
      for (let i = 0; i < steps; i++) {
        const px = x + (sec.len * i) / steps;
        // a footpath runs on at the level it was left at: a wall lifts the
        // whole course and nothing quietly relaxes it back down again
        y = baseY(px) + carry;
        push(px, y, RUN, y, W);
      }
      x += sec.len;
    } else if (sec.c === 'climb') {
      // A wall is a step, not a hill. The terrace beside the lane stands the
      // full height of the wall the moment it starts, so what the snail sees
      // ahead is a sheer face, and the lane goes straight up it in one short
      // steep push. There is no way back down: the course just gets higher.
      const h = cat.climb[0] + R() * (cat.climb[1] - cat.climb[0]);
      const y0 = y, x0 = x;
      const run = cat.climbRun[0] + R() * (cat.climbRun[1] - cat.climbRun[0]);
      const steps = Math.max(3, Math.round(run / 0.25));
      for (let i = 1; i <= steps; i++) {
        // the ground stays down at the foot, so the flank of the lane is the
        // face the snail climbs, and the lane itself stays as wide as the path
        push(x0 + (run * i) / steps, y0 + (h * i) / steps, CLIMB, y0, W);
      }
      x = x0 + run; y = y0 + h; carry += h;
    } else {
      // ---- a hole in the course, and the only way past it is off the bank.
      // A leap is a cliff over a dry chasm: the ground stands up at the lip's
      // height, the lane drops the full height to the floor, and the far side
      // is a wall back up to the lane's own level - so a snail that misses
      // lands down there and has to climb out, and the water that used to be
      // at the bottom of it is gone. A pool is the same hole at a fraction of
      // the size, with water in it and a bank you step off rather than launch
      // from, which is what the launch height in ELEMENTS is for.
      const E = ELEMENTS[sec.c] || ELEMENTS.leap;
      const wet = !!E.wet;
      // **A crate's far lip is drawn first and its groove is what is left of
      // `CRATE_X`.** The groove is cut narrow on purpose - narrower in the
      // design's `x` than the crate is wide - so that the crate overhangs it at
      // both ends wherever the course happens to be, and there is nothing to fall
      // through. See the element for why `x` and not `s` is the only width that
      // can be promised.
      const farRun = E.farRise != null ? E.farRise + R() * E.farRise : null;
      const gapLen = farRun != null ? CRATE_X - farRun
        : (cat.gap[0] + R() * (cat.gap[1] - cat.gap[0])) * E.gap;
      const y0 = y;
      // A run-up is a hill to run at, not a wall: the ground comes up with
      // the lane, so a snail can take it at pace and arrive at the cliff with
      // the speed to matter.
      if (E.runUp) {
        const up = E.runUp * (0.75 + R() * 0.5);
        x = ramp(x, y, up, 3.4 + R() * 1.6, RUN, false, W);
        y += up;
      }
      // The lip, and the width of it. This is the narrowest the lane ever gets,
      // and it is a **destination**, not a step: the run-up and the lip ramp
      // taper down to it over their own length, so the road walks in to a
      // launch edge rather than stopping dead at one. A snail taking a pool
      // from a lane that pinched in a single sample was leaving a gate, and the
      // pinch read on screen as a choke point a metre before a hazard.
      // A pool's lip is narrower than a leap's, because a pool is a bank you
      // step off and a leap is a cliff you launch from - and `lipW` is the
      // declared fraction of the lane's width either one comes to.
      const lipW = W * (E.lipW == null ? 0.88 : E.lipW);
      if (E.noLip) {
        // **A crate has a lip and not a launch.** The ramp is skipped - nothing
        // leaves the ground here, and a metre of climbing to a step you walk off
        // is a metre of climbing for nothing - but the **flat top is not**, and
        // that is the load-bearing half of this branch. `lipX` is the end of the
        // flat top and `sAtX(lipX)` is where the groove is measured to start, so a
        // crate with only a ramp has `s0` in the middle of the *drop*: the last
        // sample at the road's own level is a metre and a half *before* the first
        // of the groove's, `s0` lands between them, and the crate is standing in
        // the side of a step rather than in a groove. A leap cannot see this
        // because its own flat top is the same metre and a half, so its `s0`
        // lands on it.
        push(x + 0.45, y, RUN, y, W);
        push(x + 1.10, y, RUN, y, W);
        x += 1.10;
      } else {
        const lipH = (cat.lip[0] + R() * (cat.lip[1] - cat.lip[0])) * E.lip;
        x = ramp(x, y, lipH, 1.7 + R() * 0.8, CLIMB, true, W, lipW);
        y = y + lipH;
        push(x + 0.45, y, CLIMB, y, lipW);                 // the lip
        push(x + 1.10, y, CLIMB, y, lipW);                 // a short flat top
        x += 1.10;
      }
      const lipX = x;
      // and the height of the lip itself, which is where a flight starts. It
      // has to be read off the lane as it stands here and not off where the
      // lane was before the run-up: a snail launched from below the top of
      // its own cliff is already in the water before it leaves the ground.
      const lipY = y;
      // how far below the lane the far side of the hole is
      const drop = wet ? (1.0 + R() * 0.8) * E.drop : E.chasm[0] + R() * (E.chasm[1] - E.chasm[0]);
      const waterY = wet ? y0 - drop : null;
      const floorY = wet
        ? waterY - (cat.deep[0] + R() * (cat.deep[1] - cat.deep[0])) * E.deep
        : y0 - drop;
      // A pool is a pool, not a lake. The water reaches a little past the edge
      // of the lane and a bit further for every metre of gap, but it does not
      // grow with the gap without limit: a course with wide water would
      // otherwise drown its own track in one sheet, with no bank and no shore
      // to tell you where the swimming starts.
      // A pool's water spreads for every metre of gap; a flooded chasm is a
      // gorge, and its water is kept in the cut it filled.
      const basin = wet
        ? W + POOL_BANK + gapLen * (E.wall ? 0.22 : POOL_SPREAD)
        : 0;
      const gSteps = Math.max(6, Math.round(gapLen / 0.65));
      for (let i = 1; i <= gSteps; i++) {
        const px = lipX + (gapLen * i) / gSteps;
        // across a pool the lane is at the water's level and the flight line
        // above it belongs to whoever is airborne; down a chasm the lane is
        // the floor, and the ground of it is walked, not flown: FLY is for the
        // air over the hole and WALK is for the bottom of it. A crate's span is
        // PUSH, which is the third answer and not a fourth: the crate is the
        // hole, so the rail and the card have to have a colour for it, and a
        // snail that ever does end up down there moves at crate pace.
        //
        // **and a crate's dish is cut at both ends rather than eased into them**,
        // which is a `leap` with its chasm's own numbers and not a trough: the
        // whole of the drop is in the first sample of the dish and the whole of
        // the rise in the last, so the level changes fall in the gaps between
        // samples and the lane carries a lip. Eased over the first quarter and
        // the last, which is what this used to do, it came out as a hollow three
        // and a half metres long that a cart could have stood in, and eight
        // crates standing in the bottom of it read as eight crates on a road.
        const t = i / gSteps;
        const dip = E.crate ? (i === 1 || i >= gSteps - 1 ? 0 : drop) : drop;
        // **The lane crosses the pool at the water's level and the ground under it
        // is the bottom of the water, and those are two different numbers.** The
        // wet branch wrote `waterY` into the floor as well, which threw away the
        // depth `floorY` had just been computed for and left a basin with a
        // surface standing on its own floor: `groundYAt()` lays the middle of a
        // pool out at `fr.floor` and the rim at `fr.ground`, so a floor and a
        // surface at one height is a ground that is level with the water across
        // the whole of it - Lily Deep's four pools came out **0.588 to 0.630 m
        // deep in the plan and none of it in the ground**, and the surface, which
        // dips six centimetres at its own outer edge to lose the join, was under
        // the meadow everywhere except the middle, where the two were coplanar.
        // It read as a sheet of blue laid on the grass with a seam down it.
        //
        // The dry branch is the same number twice over and always was: `floorY` is
        // `y0 - drop` and so is `dip`, so a chasm and its floor were written out
        // of one value by two names.
        const fy = wet ? floorY : y0 - dip;
        // **and the ground beside the lane is the country the hole interrupts, so
        // it is two numbers and not one.** `basinY()` lays the bottom of a basin
        // out at `floor` and climbs to `ground` over the last `BANK_WALK` metres
        // before the shoreline, and everything downstream of that - `POOL_BERM`,
        // the sand band's `dry` weight, the reeds' `clear` - is placed against
        // where the bank puts the waterline. So `ground` is the level the bank
        // climbs **to**, and it was the floor: a pool whose bank rose from its own
        // bottom to its own bottom, which is a step down into a plain at the level
        // of the bottom, and the waterline fell outside the strip that was drawn
        // for it - **17 m out on a 12 m strip on Lily Deep's first pool**, with
        // the five metres between them under the water's own level and no water
        // on them. The sand band was under the water and the drawn edge was a
        // 13 mm sliver lying on a shelf.
        //
        // A **flood** is the other way round and must not come with it: there the
        // ground beside the lane is the bottom of the gorge, because the terrace
        // the snail launches from is `lipY` up and the drop from it to here is the
        // face the gorge stands in. Give a `leapClimb` the country it interrupts
        // and its near wall goes with it, and the one wall on the course that is a
        // face rather than a ramp is a slope.
        const gy = wet && !E.wall ? y0 : fy;
        push(px, wet ? waterY : y0 - dip, wet ? FLY : (E.crate ? PUSH : WALK), gy, W,
          { water: waterY, floor: fy, basin, rock: !wet });
      }
      x = lipX + gapLen;
      // the far side: a bank out of the water, or a wall out of the chasm
      const back = farRun != null ? farRun
        : (wet && !E.wall ? E.bank : E.back + R() * 0.8);
      const yEnd = baseY(x + back) + carry;
      if (wet && !E.wall) {
        for (let i = 0; i <= 3; i++) {
          const t = easeInOut(i / 3);
          push(x + back * (i / 3), lerp(waterY, yEnd, t), RUN, lerp(waterY, yEnd, t), W);
        }
      } else {
        // the ground stays down at the foot of it, so the flank of the lane
        // is the face the snail has to climb back up - out of the water on a
        // flooded chasm, or off the floor of a dry one. It is a long enough
        // ramp that a snail coming down short can still land on it rather
        // than only on the far lip, which would make the gap a coin toss
        // instead of a test.
        //
        // **A crate's dish has already climbed back out by the time it gets
        // here** - the taper is the rise - so it starts from the road's own level
        // and not from the bottom of the dish, or a snail that walked in without
        // shoving a crate would meet a cliff at the far end of a thing it could
        // already have walked out of.
        const footY = E.crate ? y0 : (wet ? waterY : floorY);
        const steps = Math.max(4, Math.round(back / 0.3));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          push(x + back * t, lerp(footY, yEnd, easeInOut(t)), CLIMB, footY, W);
        }
      }
      x += back; y = yEnd;
      // **`farX` is the crest of the far side** and for everything but a crate
      // nothing reads it, because a flight lands on the far road by its own arc
      // rather than at a place. A crate stands in the middle of its dish, so its
      // `s1` is the far end of the dish and `x1` already says so.
      leaps.push({ kind: sec.c, vy: E.vy, wet, x0: lipX, x1: x - back, farX: x, lipY, laneY: yEnd, waterY, floorY, crate: !!E.crate });
    }
  }
  smoothRidges(pts, meta);
  return { cat, pts, meta, leaps, tally, length: x, midX };
}

/**
 * Take the **kinks** out of the lane's height profile, and nothing else.
 *
 * The elements are laid out one at a time and each lays down its own curve - a
 * run is flat, a climb is linear, a lip is a raised cosine, a chasm drops to its
 * floor in a sample or two - and where two of those meet the **slope** is
 * discontinuous even where the height is continuous. A seam that looks like
 * nothing in a table of numbers is fifty degrees of turn in the geometry: the
 * face of a dry chasm arrived at a ramp, the ramp arrived at a lip, and the
 * lip went over the edge in a stride.
 *
 * It matters because of what the lane is. It is a ribbon **five and a half
 * metres wide**, and a ribbon swept along a path that turns tighter than its own
 * half-width folds: the inside of the turn comes back through itself and the
 * ground and the road cross over with a crease between them. That is not a
 * shading artefact, it is a hole in the course - and the tightest turn on a
 * course measured **0.6 m** of radius, which is a fifth of the width of the
 * thing being swept.
 *
 * So this is a bounded Laplacian on the heights: a quarter of the way towards
 * the average of a sample's neighbours, **capped**, and never applied across a
 * sample that is in the air. The cap is the whole of the design. A cliff is
 * supposed to be a cliff, and an uncapped smoothing would round the lip of every
 * leap on every course into a gentle mound and quietly delete the best thing
 * about them. Capped, the worst of the kinks come out - the ones that were
 * turning the ribbon inside out - and a lip is still a lip. It runs before the
 * Catmull-Rom, so the curve inherits a smooth polygon rather than being asked to
 * smooth one it can only follow.
 */
const RIDGE_PASSES = 9, RIDGE_CAP = 0.2;
// **The floor of a hole is as much a break in the lane as the air over it**, and
// the guard has to say so for both. It used to fire on `FLY` alone, which is the
// air over a pool - and a *dry* leap's gap is `WALK`, so the chasm floor was
// treated as ordinary road and got smoothed into the take-off edge beside it.
// A leap's lip is the only thing on the course that tells you where the launch
// is, it is a crease and not a curve, and blending it with the floor a metre and
// a half below it **rounds the whole thing off into a mound**: on Skydrift the
// lip of a leap came out **0.56 to 0.64 m lower than it was planned at** and a
// `leapClimb` on the same course - whose gap is `FLY` and so was always guarded
// - lost nothing. Same planner, same lip ramp, one number deciding whether the
// ledge the snail jumps from exists. It is the same class as the flight line:
// two ends of a jump are not joined up by a road, whether what is between them
// is water or broken ground.
const inHole = (sm) => sm.cond === FLY || sm.cond === WALK || sm.cond === PUSH;
function smoothRidges(pts, meta) {
  const h = pts.map((p) => p.y);
  for (let pass = 0; pass < RIDGE_PASSES; pass++) {
    const out = h.slice();
    for (let i = 1; i < h.length - 1; i++) {
      // in a hole, or next to one: a flight line and the floor under it are both
      // not smoothed, because the two ends of a jump are not joined up by a road
      if (inHole(meta[i]) || inHole(meta[i - 1]) || inHole(meta[i + 1])) continue;
      out[i] = h[i] + clamp(h[i - 1] + h[i + 1] - 2 * h[i], -RIDGE_CAP, RIDGE_CAP) * 0.5;
    }
    for (let i = 0; i < h.length; i++) h[i] = out[i];
  }
  for (let i = 0; i < h.length; i++) pts[i].y = h[i];
}

// ------------------------------------------------------------------
// What the rest of the county asks this module for. `MID_CROWN` is here
// rather than in `core.js` because it is the crown of the half-way sweep
// and the sweep is the planner's - and it is the only one of the thirteen
// that leaves, because `buildTrack()` and `newFrame()` are its only two
// callers and both are the course's.
// ------------------------------------------------------------------
export { planTrack, MID_CROWN };
