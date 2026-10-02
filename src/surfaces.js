/* ================================================================== *
 * surfaces.js
 *
 * The four surfaces the county is made of: the clay ribbon, the skirt under
 * it, the water and the ground - and the half-way mark, which is here for a
 * reason the file's own shape explains.
 *
 * **One material and four weights, and the vertices are shared across every
 * join**, so `computeVertexNormals()` gives the whole course one set of
 * normals and a split into separate meshes draws a seam along every join. What
 * used to be index groups and several materials is one material each and a
 * `detailW` attribute, because **a vertex colour can be faded halfway and a
 * material cannot**: a group boundary is a row of pixels where the maps change,
 * and grass on one side of it and rock on the other is a full-strength change in
 * that row, so however carefully the colour was laid on the half-way point the
 * line was still there.
 *
 * **`midwayOf()` is here and not in `course.js`, and it was in `course.js` first.**
 * The half-way is arithmetic on a track's samples, so upstream is where it
 * looks like it belongs - and it read `groundDrawnAt()`, which is *this* file's,
 * because a tower has to stand on ground that is actually there and the ground
 * that is actually there is the drawn ground and not `groundYAt()`'s answer. So
 * it came back down here, where `lineMarks()` can reach it and the scenery's
 * tower can reach it and neither of them is a cycle. **A function goes where its
 * reader is, and a move that cannot say which reader that is has not finished
 * being planned.**
 *
 * `roadRows()` is the other thing in this file that is not geometry. The ribbon
 * is laid on **one row per sample and four more at each of the two marks** -
 * the start and the half-way - packed at seven and five centimetres either side
 * of it, because a vertex colour cannot draw a seven-centimetre line on a row
 * 0.75 m apart: it draws 0.75 m of gradient, which is a worn edge and not a
 * stripe. The paint is a share of the row's distance to the mark rather than a
 * flag on those four rows, because a flag says they *are* the line and a sample
 * row that happens to fall four centimetres from the mark is not one of them -
 * so the line comes out with a bare stripe up its middle, and a five-centimetre
 * hole in the start line is a coin toss.
 * ================================================================== */
import {
  THREE,
  clamp,
  lerp,
  smoothstep,
  vnoise,
  fbm,
  RUN,
  CLIMB,
  FLY,
  WALK,
  PUSH,
  STEP,
  POOL_BERM,
  CRATE_WALL,
  CRATE_GAP,
  START_S,
} from './core.js';
import { world, gfxWideRows } from './graphics.js';
import { trackAt, newFrame, bankRadius, vergeBand, groundYAt, groundEdge } from './course.js';
import { mat, poolWaterMat, PAL } from './materials.js';

const _fr = newFrame();
const _c = new THREE.Color();
/** The second scratch, for laying one colour over another without losing it. */
const _s = new THREE.Color();

function laneVertex(sm, d, out) {
  out.set(sm.p.x + sm.right.x * d, 0, sm.p.z + sm.right.z * d);
  return out;
}

/**
 * The rows the track ribbon is built on, as fractions of the lane's half-width,
 * and the last two of them on each side are the **line**.
 *
 * This was four rows a third of the way out. It is ten, and four of those are
 * the pair of columns a painted stripe needs and did not have: a line is a
 * ten-centimetre band and a vertex colour cannot draw a ten-centimetre band on
 * a row a metre apart — it draws a metre of gradient, which is a worn edge and
 * not a stripe. So the outer two columns on each side are packed together at
 * three, five and ten centimetres, and the stripe is a **pair of quads** rather
 * than a soft shoulder. The price is the honest one: the inner edge of the
 * line is one quad of ramp, and there is no way to make it narrower without
 * finer geometry, which is the same bargain `buildGround()` strikes at the edge
 * of the meadow and the same reason it is a blend and not a seam.
 *
 * `0.60` is the last row that is just track. The stripe is white from `0.95` out
 * to the edge and the ramp into it is the `0.92` to `0.95` quad — see
 * `trackLineAt()`.
 */
const TRACKC = [-1, -0.99, -0.95, -0.92, -0.60, 0.60, 0.92, 0.95, 0.99, 1];
/**
 * How much of the painted line a given row of the ribbon is carrying, 0 to 1.
 *
 * It is a `smoothstep` over a span of three hundredths of the half-width —
 * about eight centimetres — and it is the **only** thing in the county that
 * draws a line with a vertex colour, so it is worth saying why that is allowed
 * here and is not a rule: a stripe is not a surface, it is a marking on one, and
 * it is the one feature in this project where being eight centimetres of ramp
 * is invisible and being a metre of ramp is a smear across a fifth of the track.
 *
 * A rock stretch carries no line at all, whatever its neighbours say. There is
 * no paint on a climbing ramp, and a stripe that ran up a wall and stopped at
 * the top of it would be the tell that it was drawn by a function.
 */
const trackLineAt = (sm, edge) => (isRock(sm) ? 0 : smoothstep(0.92, 0.95, edge));

/**
 * The two lines **across** the lane, in metres along it: the start and the
 * half-way, and no more, because a line is a marking and the course is not full
 * of them.
 *
 * These were a chequered band of geometry laid on the road at each mark, ten
 * boxes a lane wide, and the band indexed vertex **43 of a 40-vertex buffer** -
 * the last column's quad reaches an index that was never written. An index past
 * the end of a vertex buffer is not a hole in the picture, it is whatever the
 * driver had lying there, and with a bloom pass standing over the frame that is
 * a black box the width of the course at the start line and another at the
 * half-way, and a third wherever the racers carried the camera across one. The
 * same camera measured **40.7 of 255 mean and 49.9 per cent of the frame black**
 * with the two bands in and **98.9 and nought** with them out.
 *
 * So there is no floor decoration any more and the line is painted into the
 * ribbon's own vertex colour, which is where the line down each edge has always
 * been painted. The amber that told you which half of a course you were in has
 * gone off the ground with it: a seventeen-metre tower with amber caps on its
 * posts says that from a hundred metres, and a stripe never did.
 */
const lineMarks = (tr) => [START_S, midwayOf(tr)];
/** The half-width of a painted cross line, and the two centimetres it ramps over. */
const LINE_CORE = 0.07, LINE_RAMP = 0.02, LINE_GAP = 0.005;

/**
 * The rows the ribbon is built on: one per sample, and **four more at each
 * mark**, packed the way `TRACKC` packs the columns of the edge stripe.
 *
 * A vertex colour cannot draw a seven-centimetre line on a row three quarters of
 * a metre apart — it draws three quarters of a metre of gradient, which is a
 * worn edge and not a stripe — so the rows either side of the mark are put in at
 * seven and five centimetres and the paint is a hard share across the two
 * inside them. This is the same bargain `TRACKC` strikes and for the same
 * reason, and the price is the same one: the line's own edge is a quad of ramp.
 *
 * **The paint is a share of the row's own distance to the mark**, not a flag on
 * the four packed rows, and that is the whole of why a sample which happens to
 * fall inside the line is drawn painted rather than bare. A flag says these four
 * rows are the line, and a sample row that lands four centimetres from the mark
 * is not one of the four, so the line comes out with a bare stripe up its
 * middle — on a course whose samples are 0.75 m apart and whose marks are at
 * 11 m and at whatever the half-way scan found, a five-centimetre hole in the
 * start line is a coin toss, and it was on Hedgerow Dash at 11.07 m.
 *
 * **Four more at each of a crate's lips as well, and these four bring a height.**
 * Same reason, same bargain, and the row's `y` is the notch's own answer to the
 * one thing a row on the lane's own field could never say — see the note at the
 * packing. So `row.y` is a thing a row may carry and a number the three surfaces
 * read instead of `trackAt()`'s, and `row.cond` goes with it: a wall that says
 * `PUSH` is stone, and the field it sits in calls the same place road.
 */
function roadRows(tr) {
  const marks = lineMarks(tr);
  const near = (s) => {
    let d = Infinity;
    for (const m of marks) d = Math.min(d, Math.abs(s - m));
    return d;
  };
  const rows = [];
  for (let i = 0; i <= tr.n; i++) rows.push({ s: tr.sm[i].s });
  for (const m of marks) {
    for (const d of [-LINE_CORE - LINE_RAMP, -LINE_CORE, LINE_CORE, LINE_CORE + LINE_RAMP]) {
      const s = m + d;
      if (s > 0 && s < tr.length) rows.push({ s });
    }
  }
  // **A crate's two lips get four rows of their own, and each one brings its own
  // height.** The lines get four rows because a seven-centimetre stripe cannot be
  // drawn on a row three quarters of a metre apart; a notch gets four because the
  // same row spacing draws its walls at forty-one degrees and a hole with no floor
  // in it is a crease, which reads as rounded however deep it is.
  //
  // **A row's height is a thing a row may carry, and the row beside it is not
  // asked.** Rows on the lane's own field would buy nothing at all: `trackAt()`
  // interpolates, and the field between two samples is a straight line, so four
  // more points on that line are four more points on the same forty-one degrees.
  // A wall has to come off the line. So the four rows are laid at the *levels* the
  // notch has - the road's own on the lip side, the floor's on the other - and
  // `row.y` is the number the three surfaces take instead of the interpolated one.
  // It is the same bargain as `row.paint`: a row may carry something the sample
  // spacing cannot say, and the surfaces that are built off the row list read it.
  //
  // **Either side of the lip and not on it**, because `s0` is the midpoint of the
  // gap between two samples and the height at the midpoint of a drop is half the
  // drop: a row laid *on* the lip would stand halfway down the hole.
  //
  // **And the two levels are read off the track rather than off the plan**, from
  // the sample on either side of `restS`, which is the sample the notch was cut
  // into and the only place the two numbers are the same numbers the notch was
  // cut from.
  const fr = newFrame();
  for (const lp of tr.leaps) {
    if (!lp.crate) continue;
    const c = lp.crate;
    // **The two lips are the road's own level where each of them stands**, which
    // `trackAt()` cannot be asked for - the field between them runs through the
    // notch - and both are on the crate because the cut is what put them there.
    const topA = c.topA != null ? c.topA : trackAt(tr, c.restS - STEP, fr).y;
    const topB = c.topB != null ? c.topB : topA;
    const bot = trackAt(tr, c.restS, fr).y;
    for (const [s, y] of [[c.s0 - CRATE_WALL, topA], [c.s0 + CRATE_WALL, bot],
      [c.s1 - CRATE_WALL, bot], [c.s1 + CRATE_WALL, topB]]) {
      if (s > 0 && s < tr.length) rows.push({ s, y });
    }
  }
  rows.sort((a, b) => a.s - b.s);
  const out = [];
  for (const r of rows) {
    // a packed row within `LINE_GAP` of one already there is a quad five
    // millimetres wide, which is a hairline of a sliver and a shimmer under the
    // camera; the row that is already there keeps the place, because the two are
    // the same place to within a distance no vertex colour can tell apart
    if (out.length && r.s - out[out.length - 1].s < LINE_GAP) continue;
    r.paint = 1 - smoothstep(LINE_CORE, LINE_CORE + LINE_RAMP, near(r.s));
    out.push(r);
  }
  // each row's own condition and face, read off the interpolated frame rather
  // than guessed: the gap loop below skips on them, and a packed row laid beside
  // a leap has to be skipped along with it
  for (const r of out) {
    trackAt(tr, r.s, fr);
    // **and a row that brings its own height says what it is as well.** The two
    // rows that stand on a notch's walls are on the lane's own field, so the
    // field calls them road: a notch whose walls are clay at the top and stone
    // two centimetres lower is a notch with a painted rim, and the crate is meant
    // to stand in broken ground.
    r.cond = r.y != null ? PUSH : fr.cond;
    r.face = isFace(fr);
  }
  return out;
}

/**
 * `rampShare()` sampled between samples rather than at one, because the packed
 * rows are not samples. The array is a smoothed weight over three samples
 * either side, so it has no kink inside a step and a linear read across one is
 * the same curve the array is drawing.
 */
const rampShareAt = (share, s) => {
  const t = clamp(s / STEP, 0, share.length - 1);
  const i = Math.floor(t), j = Math.min(i + 1, share.length - 1);
  return lerp(share[i], share[j], t - i);
};

/**
 * The frame a **row** is drawn in, which is the interpolated frame with the row's
 * own height in it where it has one.
 *
 * It is a function rather than a line repeated in the three surfaces because a row
 * that brought a height to one of them and not to the other two is a hole with a
 * cliff in the ribbon and a hillside in the ground: the ground's height is a
 * *function* of the frame it is handed - `groundYAt()` reads `fr.y` for the lane's
 * own level, for the drop it measures a wall from and for the shelf it lays beside
 * it - so the one place a row's height has to arrive is the frame, and a surface
 * that read `row.y` for its own vertices and passed the untouched frame to the
 * ground would put a metre of terrain over its own hole.
 */
const rowFrame = (tr, row, fr) => {
  trackAt(tr, row.s, fr);
  if (row.y != null) {
    fr.y = row.y;
    // **And it says what it is, because the field it stands in does not.** The two
    // rows at the top of a notch's walls are nearer a sample of plain road, so the
    // interpolation calls them road: `isRock()` gives them clay and the line, the
    // ground's own band leaves them meadow, and `wallProfile()` lays the wide
    // terrace under them and the notch is a bowl again. A row that brings a height
    // brings the answer with it, and the answer is what `roadRows()` recorded when
    // it decided the row was a wall.
    fr.cond = row.cond;
    fr.rock = true;
  }
  return fr;
};

/**
 * Past this slope a stretch of the lane is a **face** and not a lane, and
 * nothing walks a road up it and nothing draws one on it either.
 *
 * The number is a rise over a run, and 1.6 is about fifty-eight degrees. It is
 * set from the two slopes it has to tell apart rather than by taste: the wall a
 * snail climbs out of a flooded chasm measures 0.9 to 1.2 and keeps its road,
 * and the front of the lip of one measures two and a half to six and loses it.
 * Between those two there is nothing in the county to get wrong.
 *
 * It matters because the bed is a ribbon of **fixed width** - a little under
 * three metres, lane width, however steep the ground is. Laid down a near
 * vertical face it does not lie down: it stands on its end, and the front of a
 * leapClimb became a flat slab of pale stone propped against a sand bank with
 * a shadow under its top edge, which is a plate stuck on a cliff and not a
 * cliff. The ground carries a face, and it carries it as rock.
 *
 * **Only inside a hole.** A climbing course is mostly faces - a sheer wall is
 * what a `climb` is, and the road up it is the road - and a threshold on its own
 * took the bed off thirty-four samples of Crag Ascent's hundred and twenty-two
 * and would have taken the road off a third of the course. What separates the
 * two is not how steep the ground is, it is what the ground is: a face with
 * open country behind it is a wall somebody climbs, and a face with a basin
 * behind it is the inside of a hole that the road is falling off the front of.
 * A dry leap has no basin, so a dry leap keeps its road everywhere and only a
 * flooded one loses the lip.
 */
const FACE_SLOPE = 1.6;
const isFace = (sm) => sm.basin > 0.05 && Math.abs(sm.grade) > FACE_SLOPE;

/**
 * Whether a stretch of the lane is **rock** rather than road, which is what
 * decides the material half a strip of it is drawn in.
 *
 * It is the same condition the colours have always used, and it is the one the
 * two conditions between them cover everything with: a `CLIMB` is a wall and a
 * `WALK` is the floor of a chasm, and everything else in the county is dirt
 * with grass creeping back into it. So `buildRoad()`, `buildSkirt()` and
 * `buildGround()` can all ask the same question of a sample and get one answer,
 * and a vertex that is coloured stone is never drawn in a material that says
 * it is not.
 *
 * **`PUSH` is in it for the same reason `WALK` is.** A crate's span is a hole
 * and the crate is *not* the ground, so a sample the snail is asked to cross on
 * foot answers `PUSH` and the span is not meadow: leave it out and the hole is
 * turf, `trackLineAt()` paints its two edge lines down a chasm, and
 * `rampShare()` weights it as meadow, and the one feature on the course that is a
 * hole reads as a field that happens to be a stripe.
 *
 * It answers a yes or a no, and a yes or a no is a **line** the moment it picks
 * a material. So the ribbon and the flank do not use this to choose a material
 * between two; they use `rampShare()` below, which is this smoothed, and the
 * answer it gives is a share.
 */
const isRock = (sm) => sm.cond === CLIMB || sm.cond === WALK || sm.cond === PUSH;

/**
 * How much of a **ramp** each sample of the lane is, 0 to 1, and it is a ramp
 * rather than a step because that is the only way two materials in one material
 * can meet in a gradient.
 *
 * `isRock()` is a yes or a no about a sample and a stretch of it is a few metres
 * long, so a hard boundary at each end of a wall is a line across the road - and
 * on a climbing course, where the road *is* the wall, that line is the join
 * between a snail running and a snail climbing, which is the one place in the
 * county that most wants to look like a change and least wants to look like a
 * seam. So each sample is asked where it sits between the two ends of the
 * nearest rocky stretch and given a share, over a fixed **one and a half metres**
 * either side of each end. That is two samples at this spacing, which is short
 * enough to still read as a change and long enough that the change is a gradient
 * and not a line.
 *
 * `buildRoad()` and `buildSkirt()` both read it and must agree, so it is a
 * function of the track and not of either of them - the same reason `SAND()` and
 * `wallProfile()` exist.
 */
function rampShare(tr) {
  const hard = new Float32Array(tr.n + 1);
  for (let i = 0; i <= tr.n; i++) hard[i] = isRock(tr.sm[i]) ? 1 : 0;
  const out = new Float32Array(tr.n + 1);
  for (let i = 0; i <= tr.n; i++) {
    let sum = 0, wsum = 0;
    for (let k = -2; k <= 2; k++) {
      const j = clamp(i + k, 0, tr.n);
      const w = 1 - Math.abs(k) / 3;
      sum += hard[j] * w; wsum += w;
    }
    out[i] = sum / wsum;
  }
  // and a face never carries road at all, whatever its neighbours say
  for (let i = 0; i <= tr.n; i++) if (isFace(tr.sm[i])) out[i] = 0;
  return out;
}

/** The ribbon the racers run on: crushed brick on the flat, rock on the walls. */
function buildRoad(tr) {
  const C = TRACKC.length;
  // **The rows are `roadRows()` and not the samples**, so the start and the
  // half-way have four rows of their own packed either side of them and the line
  // across the lane is a stripe rather than three quarters of a metre of
  // gradient. Everything below reads the row's own `s` and asks `trackAt()` for
  // its frame, because a packed row is not a sample and has no `sm` of its own.
  const rows = roadRows(tr), R = rows.length;
  const pos = new Float32Array(R * C * 3), col = new Float32Array(R * C * 3);
  // the `detailW` the shader cross-fades on: the track's grain on x, the ramp's
  // on y, and they sum to one because the one that is not wanted is a zero
  // rather than a weight, which is what lets each set's fetch be skipped entirely
  const rockW = new Float32Array(R * C * 3);
  // **The lane's own frame, in metres**: arc length along the lane, and metres
  // out from the centre line. This is the whole of "the grain follows the track"
  // and it is two numbers per vertex rather than a projection - see the note on
  // `uv: true` in `triplanarSets()`. The row's own `s` is its arc distance, so
  // the texture is continuous along the lane and repeats every `1 / 0.85` metres
  // without a seam anywhere, including round a corner, because the coordinate
  // that repeats is the one that runs along the bend.
  const tuv = new Float32Array(R * C * 2);
  const share = rampShare(tr);
  const fr = newFrame();
  const v = new THREE.Vector3();
  for (let i = 0; i < R; i++) {
    const row = rows[i];
    // the row's own frame, which is what the rest of this reads, and **its own
    // height where it has one**: a crate's walls are off the lane's field and the
    // ribbon is the surface that has to draw them.
    const sm = rowFrame(tr, row, fr);
    const sh = rampShareAt(share, row.s);
    for (let j = 0; j < C; j++) {
      const edge = Math.abs(TRACKC[j]);
      const d = TRACKC[j] * sm.w;
      laneVertex(sm, d, v);
      const o = (i * C + j) * 3, q = o / 3;
      pos[o] = v.x; pos[o + 1] = sm.y; pos[o + 2] = v.z;
      tuv[q * 2] = row.s; tuv[q * 2 + 1] = d;
      if (isRock(sm)) {
        _c.copy(PAL.stoneA).lerp(PAL.stoneB, vnoise(sm.x * 0.5, j * 2.1));
        // horizontal strata, the way a cut rock face beds
        _c.multiplyScalar(0.84 + 0.34 * vnoise(sm.y * 5.4, sm.x * 0.16 + j));
        // and the odd block of a different stone, so a face this big is
        // never one flat slab of colour
        _c.lerp(PAL.stoneB, Math.max(0, vnoise(sm.y * 1.3, sm.x * 0.55 + j * 0.7) - 0.56) * 1.5);
      } else {
        // The clay, and it is **crushed brick**: a red the county has nowhere
        // else, because a track drawn in `dirtA` is a footpath and the red is
        // the whole of what tells a snail it is on a course. The two colours are
        // a course's own light and shade rather than a gradient between two
        // materials - freshly laid at the verges and laid again a season ago,
        // both out of the same bag.
        //
        // The lerp is **biased**, and the bias is the number that decides whether
        // this reads as a clay court or as a plum. A straight `vnoise` is about
        // half deep on average, so the track sat at the midpoint of the two and
        // the midpoint of a hot red and a dark one is a maroon. `pow` at 1.8
        // puts the mean share of `clayDeep` at about a third, so two thirds of
        // the surface is laid brick and the deep patches are patches.
        _c.copy(PAL.clay).lerp(PAL.clayDeep, Math.pow(vnoise(sm.x * 0.35, j * 1.7), 1.8));
        // The sweep: the dust every snail has dragged up out of the middle, and
        // it is `clayDust` and not a paler clay, because brick dust ground fine
        // is a pink and not a tan. It is the thing a spectator reads as *worn*
        // and it is a term in the vertex colour rather than in the map - the map
        // is a multiply about one and carries no hue at all.
        _c.lerp(PAL.clayDust, (1 - edge) * 0.5 * (0.5 + 0.5 * vnoise(sm.x * 0.6, 7.3)));
      }
      _c.multiplyScalar(0.88 + 0.26 * vnoise(sm.x * 1.1, j * 3.3));
      // **The line**, and it is the whole of the third reference: a painted
      // stripe with the turf butted up against it and nothing at all in between.
      // Nothing creeped back in over it and nothing faded out under it - a court
      // is cut to an edge and the grass is cut to the same one - so the outer
      // three rows of this ribbon are paint and the ground's first row is grass,
      // and there is no band of bare earth between them to be a soft place for
      // the join to hide in.
      //
      // It goes on **last**, over the general value break-up and not under it,
      // and that is the other half of why it reads as paint. The
      // `multiplyScalar` above swings a quarter of a stop from row to row and
      // from metre to metre, which is right for clay and is a dashed line on
      // chalk: a stripe is painted by somebody standing still, and its own
      // wear is the `trackLineWorn` below and not a fresh draw of the noise.
      //
      // **And the same paint is the cross line**, so the two are one colour and
      // one wear and the start reads as the same sort of mark as the edge rather
      // than as a second thing laid on top. `row.paint` is already the ramp the
      // packed rows were put in to carry, so it is used as it comes rather than
      // being sharpened here: a second ramp across the same four centimetres is
      // how the line got to be half a metre wide the first time.
      //
      // **No paint on a climbing ramp**, for `trackLineAt()`'s reason and not a
      // new one: there is no paint on a wall, and a line that ran up one and
      // stopped at the top of it is the tell that it was drawn by a function.
      const line = Math.max(trackLineAt(sm, edge), isRock(sm) ? 0 : row.paint);
      if (line > 0) {
        _s.copy(PAL.trackLine).lerp(PAL.trackLineWorn, Math.max(0, vnoise(sm.x * 0.9, j * 5.1) - 0.34) * 1.6);
        _c.lerp(_s, line);
      }
      col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
      rockW[q * 3] = 1 - sh;
      rockW[q * 3 + 1] = sh;
      rockW[q * 3 + 2] = 0;
    }
  }
  // **One material and a weight, where this was two materials and a split.**
  //
  // This ribbon is the **only** surface in the county a snail climbs, and it is
  // the same ribbon that a snail runs down a flat: a wall and a road are one
  // strip of geometry with the same width and a couple of metres apart, so
  // something has to tell them apart. It used to be an index split, and an index
  // split is a row of pixels where the material changes - so the road on a flat
  // and the ramp up a wall met in a hard line, on a climbing course, at the exact
  // place the snail is asked to change from running to climbing. `mat.road` wears
  // both sets and `detailW` says how much of each this vertex is.
  //
  // The weight is a **ramp across the sample, not a step**, and that is the whole
  // of the change. `isRock()` answers true for a stretch a few metres long, and a
  // hard boundary at each end of it is a line; so each vertex is asked where it
  // is *relative* to the two ends of the nearest rocky stretch and given a share,
  // and the strip between a flat and a wall is a couple of metres of track that
  // has begun to look like a ramp. The vertices are shared as they always
  // were, so `computeVertexNormals()` below still gives the whole ribbon one set
  // of normals and there is no seam in the geometry to see either.
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    // **The gap test is on the rows' own conditions**, read off the interpolated
    // frame in `roadRows()`, so a packed row laid beside a leap is skipped with
    // it. Reading `tr.sm[]` here instead would leave a quad bridging the four
    // rows of a line laid across the mouth of a gap.
    if (rows[i].cond === FLY || rows[i + 1].cond === FLY) continue;   // the gap has no floor
    // and a face carries no road. See FACE_SLOPE: the ribbon is a fixed width
    // and on a near-vertical stretch it is standing on its end, and the ground
    // is drawn over the same ground as rock, which is what a face is. Everything
    // that survives the test is a ramp, which is what the road's second set is.
    if (rows[i].face || rows[i + 1].face) continue;
    for (let j = 0; j < C - 1; j++) {
      const v0 = i * C + j, v1 = i * C + j + 1, v2 = (i + 1) * C + j, v3 = (i + 1) * C + j + 1;
      idx.push(v0, v1, v2, v1, v3, v2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('detailW', new THREE.BufferAttribute(rockW, 3));
  g.setAttribute('trackUv', new THREE.BufferAttribute(tuv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.road);
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

/** The flanks, so the ribbon is a solid slab sitting on the landscape. */
function buildSkirt(tr) {
  // **The rows are `roadRows()` and not the samples**, for the reason the ribbon's
  // are: the flank hangs off the edge of the ribbon, so a flank built on the
  // samples is a half-metre band drawn beside a wall the ribbon is not drawing —
  // and at a crate's notch, where the ribbon's own rows are packed and standing at
  // heights the lane's field does not carry, that band would be a hillside standing
  // in the mouth of the hole.
  const rows = roadRows(tr), R = rows.length;
  const pos = new Float32Array(R * 4 * 3), col = new Float32Array(R * 4 * 3);
  const rockW = new Float32Array(R * 4 * 3);
  // the lane's own frame again, in metres: the same arc length, and the same
  // metres out from the centre line, so the flank's grain turns with the lane
  // exactly as the ribbon's does and the corner between the two meshes is a
  // corner between two surfaces and not a corner between two frames
  const tuv = new Float32Array(R * 4 * 2);
  const share = rampShare(tr);
  const fr = newFrame();
  const v = new THREE.Vector3();
  for (let i = 0; i < R; i++) {
    const row = rows[i];
    const sm = rowFrame(tr, row, fr);
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const dTop = side * sm.w;
      const dBot = side * (sm.w + 0.55);
      laneVertex(sm, dTop, v);
      const o = (i * 4 + k * 2) * 3, q = o / 3;
      pos[o] = v.x; pos[o + 1] = sm.y; pos[o + 2] = v.z;
      laneVertex(sm, dBot, v);
      // where the lane is cut above the hillside the flank must never hang
      // over the top of the verge
      pos[o + 3] = v.x; pos[o + 4] = Math.min(groundYAt(sm, dBot), sm.y); pos[o + 5] = v.z;
      tuv[q * 2] = row.s; tuv[q * 2 + 1] = dTop;
      tuv[(q + 1) * 2] = row.s; tuv[(q + 1) * 2 + 1] = dBot;
      // and the share is read between the samples for the same reason the ribbon
      // reads it there: the flank of a packed row is the flank of a row that is
      // not a sample, and the array's own nearest index would put a rock flank
      // under a clay one a third of a metre away.
      const sh = rampShareAt(share, row.s);
      const rock = isRock(sm);
      // and the share the shader reads, beside the colour rather than instead of
      // it: `isRock` still picks the two colours below, because the colour is a
      // step in its own right and a colour that cross-faded would be a different
      // argument. The *maps* cross-fade; the vertex colour is still laid with the
      // hard predicate, and the two are within a sample of each other.
      //
      // **And the share is now three numbers**, because the flank is two
      // surfaces and the third of the material is one of them: a face where the
      // ribbon is a ramp, and **sand** everywhere else. The sand takes
      // `1 - share[i]`, so it is the ribbon's own two surfaces mirrored — clay
      // flank under a clay ribbon, stone flank under a stone one, and a
      // gradient between the two at each end of every wall, which is the same
      // width and in the same place as the gradient on the ribbon above it.
      rockW[q * 3] = 0;
      rockW[q * 3 + 1] = sh;
      rockW[q * 3 + 2] = 1 - sh;
      if (rock) {
        // the face a wall is cut into: bedded in strata like the lane above
        // it, and shaded the further it falls from the light
        const h = sm.y - pos[o + 4];
        _c.copy(PAL.stoneA).lerp(PAL.stoneB, 0.3 + 0.5 * vnoise(sm.x * 0.6, k * 3.1));
        _c.multiplyScalar(0.84 + 0.30 * vnoise(sm.y * 5.4, sm.x * 0.16 + k));
        _c.multiplyScalar(1 - 0.26 * smoothstep(0, 1.4, h));
      } else {
        // **Sand, and this is the second half of the change.** The flank used to
        // be `dirtEdge` at 0.78: a hand's width of wet earth round every course
        // in the county, sitting directly under a painted line, which is what
        // made the line read as paint on a kerb in a trench rather than as the
        // edge of a court. `PAL.sand` and the shore's own mottling, so the two
        // are the same material by construction and not two similar colours —
        // the ground's shore band and this are one colour written twice, which
        // is the thing the jar exists to stop being a different thing.
        _c.copy(PAL.sand).lerp(PAL.dirtLight, 0.12 + 0.34 * fbm(sm.x * 0.19, (sm.z + dTop) * 0.19, 2));
        _c.multiplyScalar(0.9 + 0.2 * vnoise(sm.x * 0.8, k * 2.7));
        // and grit in the cracks, which is the one thing the shore has and a
        // six-centimetre kerb mostly will not
        _c.lerp(PAL.earthDeep, Math.max(0, 0.42 - fbm((sm.x + dTop) * 0.36, (sm.z + dTop) * 0.36, 2)) * 0.5);
      }
      col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
      _c.multiplyScalar(rock ? 0.9 : 1);
      col[o + 3] = _c.r; col[o + 4] = _c.g; col[o + 5] = _c.b;
    }
  }
  // The flank is the half-metre wall hanging off the edge of the ribbon, and it
  // carries **the same share** the ribbon it hangs off does — `rampShare()`, the
  // same array, because a flank of dirt under a ramp is a seam exactly as hard
  // as a ribbon of dirt under a ramp, and one is visible for every metre of the
  // other. So sand where the road is clay, rock where the road is a wall, and
  // half of each where the road is one thing becoming the other.
  //
  // A face has no flank at all - see below - and unlike the ribbon this **is** a
  // face, standing straight up out of the edge of the lane, so it takes the
  // cliff's weather as it stands, at a gain of 1 where the ramp's is 1.3. That
  // is the whole of why `mat.ledge` and `mat.road` are two materials and not one:
  // the same sets at two gains, and the flank's has a third the ramp's has not.
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    if (rows[i].cond === FLY || rows[i + 1].cond === FLY) continue;
    // A face has no flank either. The flank is a half-metre wall hanging off the
    // edge of the ribbon, and on a face that is a second vertical sheet in the
    // same place as the ground the face is carried by - so it z-fights it, and
    // a face drawn twice with a hair between the two copies flickers.
    if (rows[i].face || rows[i + 1].face) continue;
    for (let k = 0; k < 2; k++) {
      const a = i * 4 + k * 2, b = a + 1, c = (i + 1) * 4 + k * 2, d = c + 1;
      if (k === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('detailW', new THREE.BufferAttribute(rockW, 3));
  g.setAttribute('trackUv', new THREE.BufferAttribute(tuv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.ledge);
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

/** Water surfaces: one strip per stretch of basin. */
const WATER_TILE = 2.2;            // metres to a repeat of the ripple
function buildWater(tr) {
  const group = new THREE.Group();
  const meshes = [];
  let i = 0;
  while (i < tr.n) {
    if (tr.sm[i].basin <= 0.05) { i++; continue; }
    let j = i;
    while (j + 1 <= tr.n && tr.sm[j + 1].basin > 0.05) j++;
    const count = j - i + 1, C = 5;
    const pos = new Float32Array(count * C * 3), col = new Float32Array(count * C * 3);
    const uv = new Float32Array(count * C * 2);
    const idx = [];
    const v = new THREE.Vector3();
    // **The level is the first sample of the run that actually carries one, and
    // not the first sample of the run.** Those are different samples whenever a
    // pool is reached down a slope, and it cost a sheet of water in the air:
    // the basin is stamped over a pool's whole gap, the *water* is stamped over
    // the part of that gap the water is in, and where the two do not start
    // together the first sample's level is `null`. Water is a number that is
    // subtracted from, and `null - 0.10` is `-0.10`: on Skydrift the pool sits at
    // minus six and eight one, and the whole surface was built at about zero -
    // a flat blue sheet lying over the bank that leads down to it, six metres
    // above the pool, with the trench floor visible under its far edge. A null
    // that becomes zero in an arithmetic expression is the whole of it.
    let wy = null;
    for (let a = 0; a < count && wy === null; a++) if (tr.sm[i + a].water !== null) wy = tr.sm[i + a].water;
    if (wy === null) { i = j + 1; continue; }          // a basin with no water in it
    // And **a row is water only where the ground under it is below the surface.**
    // The level is flat because water is level, so a run that reaches its pool
    // down a slope has ground above the surface at its near end, and a surface
    // drawn across the whole run is a plane lying over the bank that leads to
    // the pool. The bank is the pool's own descent and the plan is right about
    // it; the surface is the thing that has to be clipped to it.
    const under = [];
    let firstWet = -1, lastWet = -1;
    for (let a = 0; a < count; a++) {
      const sm = tr.sm[i + a];
      const wet = sm.water !== null && sm.y - 0.06 < wy;
      under.push(wet);
      if (wet) { if (firstWet < 0) firstWet = a; lastWet = a; }
    }
    // how far along the course one sample is, which is the distance the
    // ripple runs down a pool
    const row = tr.length / tr.n;
    for (let a = 0; a < count; a++) {
      const sm = tr.sm[i + a];
      const hw = Math.max(0.2, bankRadius(sm) - 0.04);
      // the first and last rows of a pool are its two ends, where the ground
      // the water is dug into comes up level with the surface: the water is
      // dipped a little there so that ground wins outright and the join reads
      // as a waterline instead of a seam. **The first and last rows that are
      // water**, and not the first and last of the run, for the same reason the
      // level is not the first of the run.
      const endDip = (a === firstWet || a === lastWet) ? 0.10 : 0;
      for (let c = 0; c < C; c++) {
        const t = c / (C - 1) * 2 - 1;
        laneVertex(sm, t * hw, v);
        const o = (a * C + c) * 3;
        pos[o] = v.x;
        pos[o + 1] = wy - endDip - (Math.abs(t) > 0.99 ? 0.06 : 0);
        pos[o + 2] = v.z;
        // deeper towards the middle, and a little sky reflected at the edge
        _c.copy(PAL.waterA).lerp(PAL.waterB, Math.pow(Math.abs(t), 2.2));
        _c.lerp(PAL.waterB, 0.18 * vnoise(sm.x * 0.5, t * 3));
        col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
        // The ripple is sampled in the pool's own frame: across it is `t`, and
        // down it is the distance along the course, both of which are already
        // to hand. The surface animation rewrites positions every frame and
        // never touches this, so the ripple rides the swell instead of
        // sliding off it.
        uv[(a * C + c) * 2] = t * (hw / WATER_TILE);
        uv[(a * C + c) * 2 + 1] = ((i + a) * row) / WATER_TILE;
      }
    }
    for (let a = 0; a < count - 1; a++) {
      // and a quad is only a quad if the water is on both of its rows
      if (!under[a] || !under[a + 1]) continue;
      for (let c = 0; c < C - 1; c++) {
        const v0 = a * C + c, v1 = a * C + c + 1, v2 = (a + 1) * C + c, v3 = (a + 1) * C + c + 1;
        idx.push(v0, v1, v2, v1, v3, v2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.userData.base = pos.slice(0);
    // **A material of this pool's own**, so the reflections row can hang this
    // pool's own cube probe off it - see `poolWaterMat()`. One draw call either
    // way, and the ripple drift is a shared uniform so the pools still move as
    // one body of water. Registered so `dropCourse()` can give it back: it is
    // the course's, and nothing else in the county owns it.
    const wm = poolWaterMat();
    world.courseWater.push(wm);
    const m = new THREE.Mesh(g, wm);
    m.renderOrder = 3;
    m.frustumCulled = false;
    // **Where this pool's probe stands**: half a metre above the middle of the
    // surface, so the cube camera is out of the water it is reflecting and as far
    // from the bank as the pool allows - a probe sitting on the surface reflects
    // the floor it is half in.
    // `computeBoundingSphere()` writes the sphere onto the geometry and returns
    // nothing, which is worth knowing before it costs an afternoon
    g.computeBoundingSphere();
    m.userData.probeAt = g.boundingSphere.center.clone();
    m.userData.probeAt.y = wy + 0.5;
    group.add(m);
    meshes.push(m);
    i = j + 1;
  }
  group.userData.meshes = meshes;
  return group;
}

/** The countryside either side of the lane, following it round the corners. */
/** How far either side of a sample the true radius is measured over, and how far
 *  the tightest one within `gfxBendReach()` of it counts for the whole neighbourhood
 *  - in samples, and **the two are not the same number and the reason is the
 *  whole of this pair of constants.**
 *
 * The **basis is four**, three metres, and it is four for a reason that took the
 * measurement to see. A radius read over a long chord is a radius *averaged* over
 * it, and a corner shorter than the chord is washed out by the straight road
 * either side of it: measured over sixteen samples the tightest radius on Lily
 * Deep reads 124 where the course's own tightest step is 62, and on Grand
 * Marathon 28 where it is eighteen. A cap computed from a corner it cannot see
 * is exactly the cap that lets the fold through, and the fold is what a notch in
 * a meadow's outline is.
 *
 * It was sixteen, and the note beside it claimed a *narrow* basis was the
 * dangerous one - four samples reported a five-metre radius on a course whose
 * tightest corner was eighteen, and it would "pinch the whole country in". That
 * was true of the narrow basis **with a twelve-metre reach**, where a single
 * wobbly sample's radius was the whole of the neighbourhood's evidence. With the
 * reach at the offset's own width the argument inverts: the reach is what
 * gathers the evidence, and the basis only has to resolve one corner. A wiggle
 * that reports too small a radius now costs a strip of meadow, and a corner that
 * reports too large one costs the fold - and only one of those can be seen.
 *
 * The **reach is the ground edge**, and that is the number that was wrong by an
 * order of magnitude. It was sixteen as well, twelve metres, on the reasoning
 * that "the scale a wedge of a corner is actually about" - and the reasoning is
 * about the *corner*, not about the *offset*. A ground row is the lane's path
 * pushed out sideways by its own distance, so a row a hundred and twenty metres
 * out is being pushed past a hundred and twenty metres of lane: **every bit of
 * curvature within a hundred and twenty metres of it can fold it**, and a window
 * that only looks twelve metres either side cannot see the corner thirty metres
 * round. So the cap was computed correctly from the corners beside the sample
 * and the row folded on the ones it could not see, and the two cancelled: the
 * edge went out at seventy-one metres through the middle of a corner whose
 * radius was forty, wrapped through its own centre, and the meadow's outline
 * came back on itself as a notch.
 *
 * The reach is the offset's own width, worked out from it rather than written
 * beside it, so the two cannot fall out of step a second time.
 */
/** How far out the ground is drawn to, and how many rows the country between the
 *  verge and it is packed on.
 *
 * **A hundred and twenty is where the backdrop's hills are, and that is a real
 * number, not a taste.** The near hills stand a hundred and five to a hundred and
 * forty-five metres out with radii of twenty-six to forty-four, so the ground has
 * to finish *about where they stand* - in front of the far ones, and inside the
 * near ones, which is the only position where a hill rises out of a meadow
 * rather than sitting behind one or being buried under it. It is the number the
 * whole of the far-country work was tuned at, and it is what the draw-distance
 * row's middle step asks for, so the default is the tuned figure and the other
 * five steps move off it rather than the middle step being a compromise.
 *
 * It was **two hundred and sixty-eight**, on the reasoning that a country
 * sampled coarsely to a long way is a country that looks folded. It is: a ribbon
 * drawn to two hundred and sixty-eight is five hundred and thirty-six metres of
 * meadow, it swallows the near hills whole - their centres are a hundred and
 * forty out and they are eight to fifteen tall, so under a ground that has
 * climbed to meet them they are a wrinkle - and what is left is a green plateau
 * with a straight cut edge and sky underneath it. Wider is not further away.
 *
 * **Which is also why the low steps have to be careful.** A ground edge that stops
 * inside the near hills is fine - the fog closes over it first, at a hundred and
 * thirty metres of the hundred-and-thirty-metre fog - but a ground edge that stops
 * in open country is a straight cut with sky underneath it, and that is the shape
 * the whole paragraph above exists to avoid. So the fog ladder and the edge ladder
 * are one setting and not two, and the low steps pull the fog in to meet the edge
 * rather than trusting the edge to hide.
 *
 * The rows between the verge and it are packed on a **ratio worked out per
 * sample** so that the last of them lands exactly on the edge: a fixed ratio
 * multiplied out from a verge that moves leaves the outermost row at a hundred and
 * twenty-six here and a hundred and seventy there, so the country under it
 * is sampled at two different rates and the silhouette is two different shapes.
 */

function groundColumns(sm) {
  // The rows hug the shoreline where there is water, and follow the verge
  // where the lane is cut into a slope, so neither the bank nor the face is
  // smeared across a coarse quad. Out past the verge the rows are packed
  // closer together too, or the open country breaks into big flat wedges
  // where the hillside is sampled more coarsely than it varies.
  const br = bankRadius(sm);
  const band = vergeBand(sm);
  const a = Math.max(band + 0.8, br);
  // And the half-dozen rows **inside** the verge are packed on a ratio rather
  // than spread evenly, because the verge is where the ground is steep and the
  // rows either side of it are not. Five rows one metre apart across a face that
  // drops three metres in the first metre is one long triangle where the face
  // of a cliff should be; five rows on a ratio put three of them inside the
  // first metre and get the shape of the lip, whatever the lip's height happens
  // to be. It is also why the ground beside a leap looks like a hillside and
  // not like a plane with a road glued to it.
  const e = Math.max(0.5, band - sm.w), near = [];
  for (let k = 0.06; k < 0.95; k *= 1.9) near.push(sm.w + e * k);
  // **And the far field is denser than it was, and runs further out.** Ten rows
  // between the verge and a hundred and twenty metres put the last of them
  // fifteen metres apart, and a taper spread over five rows of fifteen metres is
  // not a taper - it is four flat shelves with a crease between each, and the
  // outermost one is a straight line two hundred metres long, which from a high
  // camera is a silhouette of a straight line against the sky. That is the
  // shape the ground was being read as having: a curled-in edge, when what it
  // is is a coarse one.
  //
  // So the far rows are packed down - `gfxWideRows()` of them on a ratio, ten at
  // the middle draw distance and as many as two dozen at the top one, which puts
  // the outermost row fourteen to twenty-four metres out. An earlier note here
  // claimed "about seven metres, carried out to two hundred and sixty"; neither
  // half of that has been true since the edge came back to a hundred and twenty,
  // and leaving it would have read as the authority for the derivation above.
  // The extra rows are the whole of the cost and it is the cheapest fix here:
  // nothing about the height field changes, only how finely it is sampled.
  // **And the country out past the verge is packed the same way the verge is**,
  // on a ratio, over a band a good deal wider - which is the whole of what makes
  // the ground the tower stands on flat rather than merely level. The verge rows
  // are packed densely because the ground is steep there; the same argument
  // applies further out with less force, and the ground between the lane and the
  // tower is the one stretch of a course that is both: flat enough to build on,
  // and a long way from the lane. Sampled coarsely - four rows between six and
  // twenty-eight metres - it is a straight line between two of them where the
  // profile is still curving, so the drawn ground and the profile it is standing
  // on differ by most of a metre, and the tower sits on whichever of the two
  // its own depth was asked about. Packing it costs nothing but vertices and
  // makes the two the same thing.
  //
  // **A fixed number of rows, and always increasing**, and both matter. The rows
  // next to the verge are offsets of the lane and the rows out in the country
  // are offsets too, so a deep cutting puts its own verge past thirteen metres
  // and collides with the row at thirteen - a column list that goes backwards
  // is a quad with its ends the wrong way round. And the count must not vary
  // from one sample to the next, because `buildGround()` lays the mesh on a
  // single row stride: a sample with fewer rows than the one before it repeats
  // the previous row's tail, and a sample with more writes off the end of the
  // vertex array. Both are silent. So the rows are built to a length and then
  // nudged into order, rather than filtered into it - a filter changes the
  // length, which is the thing that cannot be allowed to change.
  const w0 = Math.max(a + 6, 12.5);
  const WIDE = gfxWideRows();
  /** The far field: `WIDE` rows from just past the verge out to `to`,
   *  packed on a ratio worked out so that the last of them is *exactly* `to`. */
  const far = (to) => {
    const r = Math.pow(to / w0, 1 / WIDE), rows = [];
    for (let i = 1; i <= WIDE; i++) rows.push(w0 * Math.pow(r, i));
    return rows;
  };
  const head = [0, sm.w * 0.99, ...near, band, lerp(band, a, 0.5), a, a + 1.1, a + 2.4, a + 4, a + 6];

  // **The far field is the same on both sides**, and `groundEdge()` is what says
  // how far out that is - the tightest bend in reach, held on *both* sides, and
  // the ground edge beyond it. It is the *same* function the height eases out to,
  // so the outermost row and the end of the ease cannot fall out of step about
  // where the edge is, and it takes no side at all, so the two halves of the
  // ribbon are the same shape and the outline cannot step from one to the other.
  //
  // And it is **rebuilt** to the cap rather than trimmed to it. The old way took
  // every row past the radius and *put it at* the radius, so a tight bend put
  // four rows on one offset and no country at all beyond it: one side of a corner
  // a hundred and fifty metres of meadow and the other side five hundred, and
  // since a course's bends change sign, so did the wide side. That is the whole
  // of "the grass stretches out far too wide, but sometimes only partially" - not
  // one ribbon of one width, but a lawn that changes its mind about how far it
  // goes from one corner to the next. Rebuilt on the same count and the same
  // ratio, the two sides differ by the spacing of a few rows and every row is
  // still its own row. A course so tight that even the verge would fold has
  // nowhere to put its ground, and the floor on the cap is `w0 * 1.35`: out past
  // the verge, well past `NEST`, because a far field squeezed into twelve metres
  // is a crease.
  const one = (sign) => [
    ...head.map((q) => sign * q),
    ...far(groundEdge(sm)).map((q) => sign * q),
  ];
  const pos = one(1);
  // and the other side, which `one(-1)` has already signed, so it is only
  // reversed to run from the far edge in to the verge
  const out = one(-1).slice(1).reverse().concat(pos)
    .map((q, i, all) => (i && q <= all[i - 1] ? all[i - 1] + 0.05 : q));
  return out;
}

/**
 * The height of the ground **as it is drawn**, which is not the same question as
 * `groundYAt()` and the difference between the two is the whole of a flower
 * standing in mid-air.
 *
 * A course surface is a polyline. `groundColumns()` says where the rows are and
 * `buildGround()` puts a vertex at each of them with the height `groundYAt()`
 * gives there, so between two columns the ground the player can see is a straight
 * line joining the two - while `groundYAt()` itself is an analytic profile that
 * carries on curving through the gap. A prop placed by `scatter()` is placed at
 * whatever `d` its own draw happened to land on, which is almost never a column,
 * so on the inner half of the mesh the two agree to a millimetre and on the outer
 * half they can be a **metre** apart: out past the verge the columns are at
 * `a + 6, 14, 18.5, 24` and the ground falls away fast across a wall's shoulder,
 * so the straight line between two of them sits well above the curve.
 *
 * Which is a flower in the air over the top of a ramp, and it is why the same
 * scatter is correct on the meadow - where the columns are a metre apart and the
 * curve is shallow - and wrong on every ramp and lip on the course.
 *
 * So this asks the question the mesh asks: bracket `d` between the two columns
 * either side of it and take the height off the line between them. One entry of
 * cache, because a scatter walks the samples in order and asks about the same row
 * many times running.
 */
/** How wide the drawn ground is on the narrow side of a sample, and it is
 *  **the narrower of the two**, because the ribbon is held to one width on both
 *  sides and a piece on the wide side of a narrow sample is a piece on air.
 *  Shared with the placement below through the same column cache `groundDrawnAt`
 *  uses, so a scatter that walks the samples in order builds the list once. */
function groundHalfAt(sm) {
  if (_colFor !== sm) { _colFor = sm; _colCache = groundColumns(sm); }
  const cols = _colCache;
  return Math.min(-cols[0], cols[cols.length - 1]);
}
let _colFor = null, _colCache = null;
function groundDrawnAt(sm, d) {
  if (_colFor !== sm) { _colFor = sm; _colCache = groundColumns(sm); }
  const cols = _colCache;
  if (d <= cols[0] || d >= cols[cols.length - 1]) return groundYAt(sm, d);
  for (let i = 1; i < cols.length; i++) {
    if (d <= cols[i]) {
      const a = cols[i - 1], b = cols[i];
      return lerp(groundYAt(sm, a), groundYAt(sm, b), (d - a) / (b - a));
    }
  }
  return groundYAt(sm, d);
}

/** How many rows the ground has across, and it is **asked of `groundColumns()`
 *  rather than written down here** - which is the whole of why it is here. It
 *  was a constant of forty-five and the row list grew to fifty-nine, and a
 *  typed array written past its end does not complain: the vertices past the
 *  end are simply dropped, with no error and no console line, and what that
 *  looks like is a course with a hole in it. The ground lost everything from
 *  eighty-eight metres out on **both** sides at once and read as a green wedge
 *  floating in front of the backdrop.
 *
 *  A number that has to be kept in step with a list by hand is a number that
 *  will not be, so this one is derived from the list every time a course is
 *  built. The rows are laid out symmetrically, so the count is the same for
 *  every sample and the first will do.
 */
function buildGround(tr) {
  const C = groundColumns(tr.sm[0]).length;
  // **The rows are `roadRows()` and not the samples**, and this is the third
  // surface that takes them — ribbon, flank and ground are one surface with three
  // names for where it is drawn from, and a ground laid on the samples beside a
  // ribbon laid on packed rows is a straight line between two samples drawn next
  // to a wall. A crate's notch is where it shows: the ground eases down over three
  // quarters of a metre and puts a hillside over the bottom two thirds of a hole
  // the ribbon has just cut eighty-four degrees deep.
  const rows = roadRows(tr), R = rows.length;
  const pos = new Float32Array(R * C * 3), col = new Float32Array(R * C * 3);
  // How much of each of the county's other two surfaces this vertex is standing
  // in, 0 to 1: `bare` is the `rim` the stone colour is laid on with, `shore`
  // is the `smoothstep` the sand is laid on with, and `trodden` is the stone
  // again where a snail could be put down on it. All three are kept because the
  // material split below has to happen on the same numbers the colour did, and a
  // per-quad average of the four corners is the only place a quad and a vertex
  // can be asked the same question.
  const bare = new Float32Array(R * C);
  const shore = new Float32Array(R * C);
  const trodden = new Float32Array(R * C);
  // and the three weights the shader blends the three sets by, which are the
  // same three numbers written out for the geometry rather than asked of it a
  // quad at a time
  const wgt = new Float32Array(R * C * 3);
  // **How much of the track's sand edge this stretch of course is wearing**, which
  // is `1 - rampShare()` — the same number the flank's own maps are cross-faded
  // by, read here for the band the flank fades into. It is a second caller of
  // `rampShare()` on purpose: the sand on the ground and the sand on the flank
  // are one material in two places, and a band that ended where the face began
  // would be the seam this whole change is about. **Read between the samples**, for
  // the packed rows' sake, exactly as the ribbon and the flank read it.
  const rock = rampShare(tr);
  const fr = newFrame();
  const v = new THREE.Vector3();
  for (let i = 0; i < R; i++) {
    const row = rows[i];
    const sm = rowFrame(tr, row, fr);
    const sandShare = 1 - rampShareAt(rock, row.s);
    const cols = groundColumns(sm);
    // Once a row, because both of these are asked of the same sample over and
    // over and neither of them is cheap: a face is stone, and it is stone *all
    // the way*, which is the whole difference between a fringe round the meadow
    // and a surface of its own.
    const face = isFace(sm);
    const rocky = sm.rock || face;
    for (let c = 0; c < C; c++) {
      const d = cols[c];
      laneVertex(sm, d, v);
      const o = (i * C + c) * 3;
      const gy = groundYAt(sm, d);
      pos[o] = v.x; pos[o + 1] = gy; pos[o + 2] = v.z;
      const ad = Math.abs(d);
      // grass, drier on the high ground
      const patch = fbm(sm.x * 0.021, (sm.z + d) * 0.021, 2);
      const fine = vnoise(sm.x * 0.09, (sm.z + d) * 0.09);
      _c.copy(PAL.grassA).lerp(PAL.grassB, clamp(patch * 0.6 + fine * 0.25, 0, 1));
      _c.lerp(PAL.deep, smoothstep(0.6, 0.95, patch) * 0.45);
      _c.lerp(PAL.dry, smoothstep(0.4, 2.8, gy - sm.ground) * 0.55);
      // **The sand of the track's edge, spread out into the bank.**
      //
      // This branch used to hold a ring of `dirtEdge` laid on with a `smoothstep`
      // running a metre and a two out from the lane, which put a soft band of
      // trodden earth round every course *inside* the ribbon's own painted line -
      // and the join between the track and the meadow was therefore two gradients
      // stacked, so the one thing that ought to be a cut was a fade.
      //
      // The cut is now the paint, four rows of ribbon in `buildRoad()`, and this
      // is the one band that is left: the **flank** is sand (`buildSkirt()`), and
      // sand does not meet a grass bank by stopping. It is raked out into it and
      // thins, so what lies on the ground here is a continuation of the flank
      // rather than a second thing, and it is the same `PAL.sand` and the same
      // share the flank uses, so it thins to nothing over exactly the same metre
      // and a half the flank's rock takes to arrive.
      //
      // It is **not** the old ring. That one was a stain in a colour nothing else
      // in the county wears, and it started under the paint; this one is the
      // colour of the surface immediately above it, it begins at the flank's
      // outer edge rather than the lane's, and it ends in the meadow.
      if (sandShare > 0.002) {
        // measured from the **flank's** outer edge and not the lane's, so the two
        // surfaces meet at full strength instead of the band peaking somewhere
        // underneath the flank where nothing can see it
        const out = smoothstep(sm.w + 1.5, sm.w + 0.5, ad);
        const edge = out * sandShare;
        // **and it goes into the shore bucket, not only into the colour.** The shore
        // is the sand set, and a band that laid sand on the vertex and left the
        // weight on the turf is a metre of beach wearing the meadow's grain, which
        // is a join as visible as the one the paint just cut: `grass-albedo` at
        // 1.20 and `sand-albedo` at 1.35 are different greens from different
        // maps, and they change across a weight that did not move. Colour and
        // weight off the same number is the rule this whole mesh is built on.
        const k = i * C + c;
        if (edge > shore[k]) shore[k] = edge;
        _c.lerp(PAL.sand, edge * 0.92);
        // and the grit in it, the shore's own terms, because this is the shore's
        // material in the shore's place and half of it is the grain
        const g = vnoise(sm.x * 0.8, (sm.z + d) * 0.8);
        _c.lerp(PAL.earthDeep, Math.max(0, g - 0.42) * 0.8 * out);
        _c.lerp(PAL.dirtLight, Math.max(0, 0.34 - g) * 0.7 * out);
      }
      const br = bankRadius(sm);
      if (br > 0.05) {
        // The shore: dry sand up the bank, wet sand and mud right at the
        // waterline, and the bed showing through where it is shallow. It is a
        // band rather than a line, and it is mottled, or the water reads as
        // having been laid on the grass. The band is wide: the sand runs a
        // good way out past the water before the meadow takes it back.
        const dry = smoothstep(br + POOL_BERM + 2.2, br - 0.2, ad) * 0.92;
        // `max` and not `=`: a pool's own sand band and the track's edge band can
        // overlap on a course that has both, and whichever asked for more of the
        // shore is the one that is standing there.
        shore[i * C + c] = Math.max(shore[i * C + c], dry);
        _c.lerp(PAL.sand, dry);
        _c.lerp(PAL.earthDeep, smoothstep(br + 0.2, br - 1.2, ad) * 0.55);
        const grit = vnoise(sm.x * 0.8, (sm.z + d) * 0.8);
        _c.lerp(PAL.earthDeep, Math.max(0, grit - 0.42) * 0.8);
        _c.lerp(PAL.dirtLight, Math.max(0, 0.34 - grit) * 0.7);
        _c.multiplyScalar(0.9 + 0.2 * fbm((sm.x + d) * 0.05, (sm.z + d) * 0.05, 2));
      }
      // And the floor of a hole is broken stone rather than meadow - sampled in
      // world space, so the bedding runs along the floor as well as across it,
      // and a good deal darker the further down the walls you are, because the
      // bottom of a hole has to read as a bottom and not as a strip of the
      // surface let down.
      //
      // A **face** is stone for the same reason, and it is the same block: the
      // bed and the flank both stop at FACE_SLOPE, so on a face this is the only
      // thing there is. Without it the front of the lip of a leapClimb was sand
      // where the road had just been, which is a bank with a hole cut in it.
      //
      // It is **laid over** the meadow and not instead of it, because the row is
      // two hundred and forty metres wide. Colouring a whole sample stone put
      // the broken rock of a chasm out to the horizon on both sides of Skydrift
      // and turned a two-metre hole in the county into a moor of it.
      if (rocky) {
        const wx = sm.x + sm.right.x * d, wz = sm.z + sm.right.z * d;
        const depth = clamp((sm.y - gy) / 1.2, 0, 1);
        // The stone does not begin at a constant distance from the middle of the
        // lane, and this is the line in the county that says so. The fade is
        // **pushed in and out in world space** by two octaves, so the break in
        // the turf wanders across the hillside instead of running dead parallel to
        // the course for the whole of it: a smoothstep on distance alone is an
        // **offset curve of the lane**, and an offset curve of a straight lane is
        // a ruled line - which is what the turf-to-stone edge looked like from the
        // air. Both edges of the smoothstep move together, so the band stays nine
        // metres wide and it is the *place* that moves, not the softness.
        //
        // Damped to nothing on a **face**, and that is the one place it has to
        // be: on a face the stone is not a fringe round the edge of the meadow,
        // it is the surface, and a boundary that wandered across it would leave
        // turf hanging on a cliff.
        const wob = ((fbm(wx * 0.055, wz * 0.055, 3) - 0.5) * 7.0
          + (fbm(wx * 0.16, wz * 0.16, 2) - 0.5) * 2.4
          + (fbm(wx * 0.42, wz * 0.42, 2) - 0.5) * 0.9) * (face ? 0.12 : 1);
        const rim = 1 - smoothstep(sm.w + 2.0 + wob, sm.w + 11 + wob, ad);
        bare[i * C + c] = rim;
        if (rim > 0.004) {
          _s.copy(PAL.stoneA).lerp(PAL.stoneB, 0.18 + 0.62 * fbm(wx * 0.17, wz * 0.17, 2));
          // broken slabs, and bedding across them
          _s.multiplyScalar(0.80 + 0.34 * vnoise(wx * 0.95, wz * 0.95));
          _s.lerp(PAL.stoneB, Math.max(0, vnoise(wx * 0.5 + 4, wz * 0.5) - 0.4) * 1.5);
          // and the odd patch of grit and shadow in the cracks
          _s.lerp(PAL.earthDeep, Math.max(0, 0.44 - fbm(wx * 0.4, wz * 0.4, 2)) * 0.85);
          _s.lerp(PAL.earthDeep, depth * 0.4);
          _c.lerp(_s, rim * 0.95);

          // **A snail can walk a good deal of this rock, and the top of a wall is
          // meant to be a terrace and not a shelf of stone.** The top of a `climb`
          // stands at the full height of the wall it is, so there is a wide flat
          // shoulder either side of the lane at the top of it - and that was drawn
          // as stone, which made the one surface on a climbing course a snail
          // spends real time on read as the same cliff it is climbing.
          //
          // So the walkable part is **sand**, laid over the stone and not instead
          // of it, on the same `rim` that decides the stone, so the colour and the
          // material change together the way every other join on this mesh does. It
          // goes into the **existing** sand bucket and not a fourth group: sand is
          // one material here however it got there, and a terrace is the same sand
          // a pool has round it.
          //
          // **What decides walkable is the ground's own cross-slope here**, and it
          // used to be `isFace(sm)` and that was the whole of the straight line
          // across the terrace. `isFace` is a **per-row** answer - it is hoisted out
          // of the inner loop because it only asks about the *lane's* grade - and
          // the lane's grade says nothing whatever about where the ground turns
          // across a row that is two hundred and forty metres wide. So the sand/rock
          // line was drawn at whatever lateral position one number for the whole row
          // implied, which is a line running dead parallel to the road and is what
          // the photograph is of. The drawn ground's own fall over a column and a
          // half either side is the right question, and it has the other property
          // that matters: it varies **continuously** with `d`, so the boundary lands
          // on the real turn in the ground and follows it round.
          //
          // 0.55 is a rise over run of about twenty-nine degrees, and it is set by
          // the two slopes it has to tell apart rather than by taste: a terrace
          // beside a wall falls away at under a tenth, and the face below it stands
          // at the fifty-eight the cliff is drawn at. There is nothing in the county
          // between those two to get wrong.
          const fall = (groundDrawnAt(sm, d + 1.6) - groundDrawnAt(sm, d - 1.6)) / 3.2;
          const trod = Math.abs(fall) < 0.55 ? rim : 0;
          trodden[i * C + c] = trod;
          if (trod > 0.004) {
            _s.copy(PAL.sand).lerp(PAL.dirtLight, 0.12 + 0.34 * fbm(wx * 0.19, wz * 0.19, 2));
            _s.multiplyScalar(0.88 + 0.26 * vnoise(wx * 0.8, wz * 0.8));
            _s.lerp(PAL.earthDeep, Math.max(0, 0.42 - fbm(wx * 0.36, wz * 0.36, 2)) * 0.7);
            _c.lerp(_s, trod * 0.95);
          }
        }
      }
      _c.multiplyScalar(0.84 + 0.3 * vnoise(sm.x * 0.42, (sm.z + d) * 0.42));
      col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
      // The `detailW` the shader cross-fades on, written here beside the colour
      // it belongs to because **it is the same three numbers**: the turf's share
      // is what is left of the fade the colour was laid on with, the rock's is
      // `rim`, and the sand's is the shore's band *or* the walkable terrace —
      // whichever asks for more of it, because a terrace at a pool's edge is both
      // and it is sand either way.
      //
      // They sum to one, and where they would not the largest two are scaled down
      // to fit rather than the third being pushed below zero, because a negative
      // weight is not "no share of that set" — it is the *other* end of the blend
      // and the shader would take it as such.
      const q = o / 3;
      let wr = bare[i * C + c], ws = Math.max(shore[i * C + c], trodden[i * C + c]);
      const tot = wr + ws;
      if (tot > 1) { wr /= tot; ws /= tot; }
      wgt[q * 3] = 1 - wr - ws;
      wgt[q * 3 + 1] = wr;
      wgt[q * 3 + 2] = ws;
    }
  }
  // **One index list and one material, where this was three groups and three.**
  //
  // The three buckets were turf for the meadow, cliff for the bare rock of a hole
  // and the face of a leap, and sand for the shore round a pool, each split on the
  // halfway point of the same fade its colour was laid on with. That was right
  // about the colour and it could not be right about the **material**, and the
  // reason is now written into `triplanarSets()`: a material boundary is a row of
  // pixels where the maps change, and no fade of the vertex colour can take that
  // row out. So the split is gone and the three numbers the split was asking for
  // are the weights instead, and the shader blends the three sets by them.
  //
  // So the turf-to-stone edge is now the width of a **quad** and a gradient across
  // it, out on the open country where a quad is two to six metres, and the same
  // edge close in beside the lane where the rows are a metre apart is a metre of
  // gradient. That is as fine as this mesh can make it, and it is a blend and not
  // a seam at every width.
  //
  // The `wob` above is what actually decides *where* the edge is, and the jitter
  // that used to break it up is gone: a dither is a way of softening a step by
  // making it messy, and there is no step left to soften. Two notes on what that
  // loses. The dither used to let stone and turf **interleave** in patches, which
  // is how broken ground goes over; a weight cannot interleave, it can only fade,
  // and the fading is across one quad rather than across several. And the
  // halfway-point rule is now the rule for the *weight* rather than for the
  // material, which means the stone and the turf are each at half in the middle of
  // the band instead of one of them being wholly in charge of the quad - which is
  // the point.
  //
  // The vertices are shared as they always were, so `computeVertexNormals()`
  // still gives the whole surface one set of normals.
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    for (let c = 0; c < C - 1; c++) {
      const a = i * C + c, b = a + 1, cc = (i + 1) * C + c, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('detailW', new THREE.BufferAttribute(wgt, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.course);
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

/**
 * Where the half-way mark goes.
 *
 * The middle of a race is the middle of the **raced** span - the grid to the
 * finish - and not the middle of the course's plan, because a plan's `x` is not
 * its arc length: by the half-way the lane has been round a good many corners
 * and through whatever the features put in it. So the mark starts at
 * `(START_S + finish) / 2` exactly, which is the right answer whenever it is
 * usable.
 *
 * And quite often it is not, because the middle of a course is quite often the
 * middle of a pool, and a line laid across two metres of water is not a line
 * anybody sees. So it walks outward to the nearest stretch of dry plain lane,
 * within a fifth of the race, which is far enough to always find one and near
 * enough that the mark is still the half-way. A wall will do as a second
 * answer, because a line on a ramp is a line and a line in a chasm is not.
 *
 * The tower goes wherever the mark went. A tower and a line that disagree about
 * where the half-way is would be worse than having neither.
 *
 * **And the ground has to be there.** Dry lane is a question about the road; a
 * tower is a seventeen-metre building on a nine-metre footprint standing fifteen
 * metres off it, and it needs two things the lane beside it says nothing about.
 * Its ground has to be **level across that footprint**, or the tower shows a
 * metre of its own base above the grass on the downhill side and is buried to
 * the first course on the other. And the lane beside it must not be **perched**:
 * a lane standing well above the country is a lane on the lip of a drop, and the
 * ground fifteen metres out from under it is the bottom of a face - which on
 * Crag Ascent is a tower at the bottom of a three-metre step, which is not a
 * flat site whatever the arithmetic half-way says about it.
 *
 * So the walk outward asks for those first and settles for the road's own
 * dryness only if it cannot have them, which is the same order the two tests
 * already had: the best answer that is still the half-way, and an answer at worst
 * a whole clear stretch away. A course that is all cliff gets the road's answer,
 * because a tower is better than no tower.
 */
/** How much clear ground the middle of a course is promised either side of the
 *  road as well as under the tower, and the floor on the whole claim. */
const MID_CLEAR = 16;
const TOWER_FOOT = 4.5;        // the tower's own radius, for the ground it stands on
const MID_FLAT = 1.0;          // metres of fall across that footprint, at the most
const MID_PERCH = 1.6;         // metres the lane may stand above the country

const midwayOf = (tr) => {
  // **And a shove run is not clear, however plain it looks.** The three and a
  // half metres of ordinary `RUN` lane in front of a crate hole - the road a
  // snail walks up before it puts its hands on its own crate - are exactly the
  // sort of stretch this function is looking for: flat, dry, wide, and `RUN`.
  // Nothing in the sample says a crate, because the samples *are* footpath, and
  // the eight crates are placed after the tower rather than scattered and so
  // nothing else knows they are there. So the run is asked about directly, and
  // it is `tr.leaps` and not the conditions because the condition is exactly
  // what is lying.
  const shoving = (s) => tr.leaps.some((lp) => lp.crate
    && s > lp.crate.startS - CRATE_GAP - 0.5 && s < lp.s0);
  // **The middle of the clearest stretch of the course.** Not the arithmetic
  // middle, and not the middle of the clear band either - the band is laid down
  // in the plan's own `x`, and converting that to a place on the track means
  // comparing a design coordinate against a sample's, and a sample's `x` is the
  // design `x` re-sampled along the curve rather than the arc distance the
  // checkpoint is placed in. The two drift, and the drift is not a rounding
  // error: on Lily Deep the band claims to begin seven metres before the second
  // pool ends, and its centre lands eleven metres short of the middle of the gap
  // it was cut for.
  //
  // So it is found on the track, in the space the checkpoint is actually placed
  // in: **the widest run of plain lane on the course, and the centre of that.**
  // The band the plan reserves is by a long way the widest clear stretch there
  // is - it is the only one built to be that wide - so the rule finds it, and
  // it finds it in the units it is going to be used in. Nothing has to convert
  // between the planner's coordinates and the track's, because the only
  // coordinate involved is the track's own.
  //
  // **and never past the finish line, which is the whole of what was wrong with
  // it.** The samples carry on beyond `finish` into the run-out the finishing
  // camera stands in, and the run-out is a long flat straight lane with nothing
  // in it at all - so on a water course it is the widest clear stretch there is.
  // Lily Deep's is twenty-four point eight metres against the band's twenty-one,
  // it won, `want` clamped itself to `tr.finish`, and the tower and the half-way
  // line were both built on the line. A stretch of lane the race never covers is
  // not a candidate for its own half-way mark however clear it happens to be.
  const i0 = clamp(Math.ceil(START_S / STEP), 0, tr.n);
  const i1 = clamp(Math.floor(tr.finish / STEP), 0, tr.n);
  const midS = (START_S + tr.finish) / 2;
  // the stretch the site search below is allowed to move inside, which is the
  // clear run itself where there was one and the whole race where there was not
  let want = midS, winLo = START_S, winHi = tr.finish;
  {
    const clear = (sm) => sm.water === null && !sm.rock && sm.cond === RUN && !shoving(sm.s);
    let best = null, runStart = -1;
    for (let i = i0; i <= i1 + 1; i++) {
      const ok = i <= i1 && clear(tr.sm[i]);
      if (ok && runStart < 0) runStart = i;
      if (!ok && runStart >= 0) {
        // the run closes on `finish` and not on the sample after it, because the
        // samples are half a metre apart in `s` and the race can end inside one
        const s0 = runStart * STEP, s1 = Math.min(i * STEP, tr.finish), c = (s0 + s1) / 2;
        // **length against nearness, in metres**, so the one stretch built to be
        // wide wins without a narrow footpath at one end of the course able to
        // outscore it by being marginally longer
        const score = (s1 - s0) - 3 * Math.abs(c - midS);
        if (!best || score > best.score) best = { score, s0, s1 };
        runStart = -1;
      }
    }
    if (best) { want = (best.s0 + best.s1) / 2; winLo = best.s0; winHi = best.s1; }
  }
  const at = (s) => tr.sm[clamp(Math.round(s / STEP), 0, tr.n)];
  const plain = (sm) => sm.water === null && !sm.rock && sm.basin <= 0.05 && sm.cond === RUN && !shoving(sm.s);
  const dry = (sm) => sm.water === null && !sm.rock;
  // The site, asked of the **drawn** ground and not of the profile: fifteen
  // metres out is where the rows are four to seven metres apart, and the mesh is
  // a straight line between them where the profile is still curving, so what the
  // tower is actually standing on is the drawn one.
  //
  // And it is asked over the **whole footprint in two dimensions**, which is the
  // half that was missing. A building nine metres across on a hillside that
  // climbs along the course is not standing on one height: the ground under the
  // downhill end of it is a couple of metres below the ground under the uphill
  // end, and a test that walks out sideways at a single point measures a lawn
  // and says yes. That is how a tower ended up with three metres of its own
  // buttresses under the turf on a climbing course - the ground beside it was
  // flat in every direction the test looked and a slope in the one it did not.
  const fr = newFrame();
  const site = (s, sm) => {
    const c = sm.crown;
    let lo = Infinity, hi = -Infinity;
    for (let along = -TOWER_FOOT; along <= TOWER_FOOT; along += TOWER_FOOT) {
      trackAt(tr, s + along, fr);
      for (let d = c - TOWER_FOOT; d <= c + TOWER_FOOT; d += TOWER_FOOT / 2) {
        const y = groundDrawnAt(fr, -d);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    return hi - lo <= MID_FLAT && Math.abs(fr.y - fr.ground) <= MID_PERCH;
  };
  const tries = [
    (s, sm) => site(s, sm) && plain(sm),
    (s, sm) => site(s, sm) && dry(sm),
    (s, sm) => plain(sm),
    (s, sm) => dry(sm),
  ];
  for (const ok of tries) {
    if (ok(want, at(want))) return want;
    for (let step = STEP; step <= winHi - winLo; step += STEP) {
      for (const s of [want + step, want - step]) {
        if (s < winLo || s > winHi) continue;
        const sm = at(s);
        if (ok(s, sm)) return s;
      }
    }
  }
  return want;
};

// ------------------------------------------------------------------
// The four surfaces and the half-way. `roadRows()` is exported for the
// scenery - the lamps read a row's own frame - and so is `laneVertex()`,
// which is how a thing standing beside the lane finds where beside is.
// ------------------------------------------------------------------
export {
  laneVertex, roadRows, rowFrame, rampShare, isRock, isFace,
  buildRoad, buildSkirt, buildWater, buildGround,
  groundColumns, groundHalfAt, groundDrawnAt,
  lineMarks, midwayOf, MID_CLEAR, TOWER_FOOT, MID_FLAT, MID_PERCH, WATER_TILE, _fr,
};
