/* ================================================================== *
 * course.js
 *
 * The lane and the country either side of it. A plan comes back from `plan.js`
 * as a design line and leaves this file as **samples every 750 mm carrying a full
 * frame** - a position, a tangent, a right, a width, a level, a slope - and a
 * *ground function* that says how far the hillside falls away from any frame to
 * either side. Every surface, every prop and every snail afterwards is placed by
 * asking those two questions.
 *
 * **Everything here is a function of a frame, and that is the whole of why it is
 * one file.** `groundYAt(fr, d)` reads `fr.y` for the lane's own level, measures
 * a wall from the difference between the lane and the hillside, and lays a shelf
 * beside it - so a frame read off the wrong row is a hillside in the wrong place
 * with the lane above it exactly where it was, and **nothing else in the frame
 * would show it**. The golden spec's terrain trace exists for that one reason.
 *
 * It is 600 lines and it is the only file in the county that both reads a plan
 * and knows about the ground, which is what makes `surfaces.js` and
 * `scenery.js` two files rather than one: the ribbon wants `groundYAt()` and does
 * not want `buildTrack()`, and the lamps want `bankRadius()` and neither.
 *
 * ================================================================== */
import {
  THREE,
  TAU,
  clamp,
  lerp,
  smoothstep,
  easeInOut,
  vnoise,
  hills,
  RUN,
  PUSH,
  LANE_HW,
  CRATE_BACK,
  CRATE_HW,
  CRATE_FLARE,
  POOL_BERM,
  STEP,
} from './core.js';
import { gfxEdge, gfxGroundFloor } from './graphics.js';
import { planTrack, MID_CROWN } from './plan.js';
/** The two sample counts the bend radius is read over, and they are not the same
 *  number. */
const BEND_BASIS = 4;
const gfxBendReach = () => Math.round(gfxEdge() / STEP);

/** How close to the centre of a bend the ground on its inside may be drawn, as
 *  a fraction of the radius, and the floor on that in metres. Just short of the
 *  radius is the cusp; a tenth short is a ribbon that is narrow on the inside
 *  of a tight corner and does not come back on itself. */
const NEST_FRACTION = 0.9;
const NEST = 12;

/** How far of the way from the height a course starts at to the height it ends
 *  at its outer edge sits. A third: enough that the edge is plainly lower than
 *  the road on a climbing course, little enough that the country is still the
 *  same country and not a plain. */
const EDGE_THIRD = 1 / 3;

/** Resample a plan into evenly spaced samples carrying a full frame. */
function buildTrack(catId, seed, lenScale) {
  const plan = planTrack(catId, seed, lenScale);
  // **The plan's points become vectors here, and this is the one line the
  // planner's move out of this file cost.** `planTrack()` hands back plain
  // `{x, y, z}` - it reads `.x` and writes `.y` on them and never calls a
  // method, which is what lets `src/plan.js` be imported by a node process at
  // all, and `tools/plan-test.mjs` is that process.
  //
  // A `CatmullRomCurve3` will not take them as they are, and the reason is
  // worth having written down: with `centripetal` parameterisation it takes
  // `p1 = points[i]` and calls **`p1.distanceToSquared(p2)`** to weight the
  // span between two control points. It is not a component read. So the array
  // it is given is mapped into real vectors on the way in, and every point
  // downstream of here is the same `THREE.Vector3` it has always been.
  const curve = new THREE.CatmullRomCurve3(
    plan.pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, 'centripetal', 0.5);
  const DENSE = Math.max(900, plan.pts.length * 30);
  const dense = [];
  let len = 0, prev = curve.getPoint(0);
  dense.push({ t: 0, p: prev, s: 0 });
  for (let i = 1; i <= DENSE; i++) {
    const t = i / DENSE, p = curve.getPoint(t);
    len += p.distanceTo(prev);
    dense.push({ t, p, s: len });
    prev = p;
  }
  const n = Math.max(16, Math.round(len / STEP));
  const sm = [];
  let j = 0, mi = 0;
  for (let i = 0; i <= n; i++) {
    const target = (len * i) / n;
    while (j < dense.length - 2 && dense[j + 1].s < target) j++;
    const a = dense[j], b = dense[j + 1];
    const u = b.s > a.s ? (target - a.s) / (b.s - a.s) : 0;
    const p = a.p.clone().lerp(b.p, u);
    while (mi < plan.meta.length - 1 && p.x > plan.pts[mi + 1].x) mi++;
    const ma = plan.meta[mi], mb = plan.meta[Math.min(mi + 1, plan.meta.length - 1)];
    // the section fields step at feature boundaries, so the nearer one wins
    const near = target > (b.s + a.s) / 2 ? mb : ma;
    let water = near.water;
    if (water === null) {
      // a body of water laps up against the bank it sits in, so the sample at
      // a feature boundary takes the level from the water beside it - but only
      // if that water is at its own level, or a pool would spill out over a
      // dry gap standing next to it
      const from = ma.water !== null ? ma : (mb.water !== null ? mb : null);
      water = from && Math.abs(from.water - p.y) < 1.6 ? from.water : null;
    }
    sm.push({
      p,
      x: p.x, z: p.z,
      y: p.y,
      // **The sample's own arc length**, and it is here because the track's
      // texture is projected in the *lane's* frame rather than the world's - see
      // `buildRoad()` - and a coordinate that runs with the bend is the arc
      // length and nothing else. Several notes in this file already talk about
      // a sample's `s`; this is the one that makes it so. `target` is the arc
      // distance the sample was placed at, so it is exact and it is monotone.
      s: target,
      ground: near.ground,
      w: near.w,
      water,
      floor: lerp(ma.floor, mb.floor, 0.5),
      basin: lerp(ma.basin, mb.basin, 0.5),
      cond: near.cond,
      crown: near.crown == null ? MID_CROWN : near.crown,   // the sweep's own radius here
      edgeY: 0,          // the outer edge's level, filled in below once the
                         // course's own rise is known
      rock: !!(near.rock || mb.rock),        // the floor of a chasm, bare stone
      fwd: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(),
      k: 0, hill: 0, grade: 0,
    });
  }
  // frames, curvature and the hillside the lane is cut into
  for (let i = 0; i <= n; i++) {
    const a = sm[Math.max(0, i - 1)], b = sm[Math.min(n, i + 1)];
    sm[i].fwd.subVectors(b.p, a.p);
    if (sm[i].fwd.lengthSq() < 1e-9) sm[i].fwd.set(1, 0, 0);
    sm[i].fwd.normalize();
    sm[i].right.crossVectors(sm[i].fwd, sm[i].up).normalize();
    const h1 = Math.atan2(sm[Math.min(n, i + 2)].fwd.z, sm[Math.min(n, i + 2)].fwd.x);
    const h2 = Math.atan2(sm[Math.max(0, i - 2)].fwd.z, sm[Math.max(0, i - 2)].fwd.x);
    let k = Math.abs(h1 - h2);
    if (k > Math.PI) k = TAU - k;
    sm[i].k = k / (4 * STEP);
    sm[i].hill = hills(sm[i].x, sm[i].z);
    // **The true radius of the bend**, signed, and it is a different number from
    // `k` above. `k` divides by `4 * STEP` because the sim wants a corner the
    // snail can feel at race pace; the geometry wants the radius the ground is
    // actually drawn on, and the two disagree wherever the samples bunch up.
    // Signed because which way the ground folds is the whole of it: a positive
    // radius means the centre of the bend is on the `+d` side, and that is the
    // side whose offsets run out of road.
    {
      const a = sm[Math.max(0, i - BEND_BASIS)], b = sm[Math.min(n, i + BEND_BASIS)];
      const run = a.p.distanceTo(b.p);
      let turn = Math.atan2(b.fwd.z, b.fwd.x) - Math.atan2(a.fwd.z, a.fwd.x);
      if (turn > Math.PI) turn -= TAU;
      if (turn < -Math.PI) turn += TAU;
      // and 1e6 rather than Infinity, because this is lerped and a frame's
      // curvature has to be a number like every other one
      sm[i].bend = run < 1e-3 || Math.abs(turn) < 1e-4 ? 1e6 : run / turn;
    }
  }
  // And the one it is actually for is the **tightest** bend within reach, not
  // this sample's own. A ribbon a hundred and twenty metres wide folds wherever
  // the tightest bend in that stretch is, and a single sample's radius says
  // nothing about a hundred and twenty metres of it - so the radius each sample
  // carries is the smallest within `gfxBendReach()` samples either side. That is
  // also why the basis is narrow: measured over four samples it is mostly
  // reading the wiggle, and it reported a five-metre radius on a course whose
  // tightest corner is eighteen, which would have pinched the whole country in.
  //
  // **And a median goes over the local radius first, and that is the whole of
  // how the two of those are not in each other's way.** The basis has to be
  // narrow - a corner shorter than the chord is averaged away by the straight
  // road either side of it, and a cap computed from a corner it cannot see is
  // exactly the cap that lets the fold through. A narrow basis on a spline also
  // reads the spline's own per-sample noise, and the noise is a *tight* radius
  // in the wrong place: Cloudsail Sky's tightest single step is thirty-six
  // metres on a course whose tightest real corner is a hundred. With the reach
  // now a hundred and twenty samples, one of those samples is not a pinprick in
  // the country: it is the **tightest thing in two hundred and forty metres of
  // it**, and the whole of the meadow on both sides is held to thirty-two metres
  // because of it. That is how the ribbon ended up narrower than the scenery
  // standing on it.
  //
  // A five-sample median is the filter for exactly that: a real corner is
  // dozens of samples long and survives being replaced by its neighbours' middle
  // value, and a noise spike one sample wide does not. It is a median and not a
  // mean because a mean of a radius is a radius of a mean, and a corner that is
  // tight for five samples in a hundred is a corner.
  {
    const local = sm.map((q) => q.bend);
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n, i + 2);
      const win = [];
      for (let j = a; j <= b; j++) win.push(Math.abs(local[j]));
      win.sort((x, y) => x - y);
      const med = win[win.length >> 1];
      sm[i].bend = med * (Math.sign(local[i]) || 1);
    }
  }
  {
    const B = gfxBendReach();
    for (let i = 0; i <= n; i++) {
      let best = 1e6, sign = 1;
      for (let j = Math.max(0, i - B); j <= Math.min(n, i + B); j++) {
        const r = Math.abs(sm[j].bend);
        if (r < best) { best = r; sign = Math.sign(sm[j].bend) || 1; }
      }
      sm[i].bend = best * sign;
    }
  }
  // **The outer edge's level**, which is one number for the whole course: a
  // third of the way from the height the lane starts at to the height it ends
  // at. It cannot be worked out per sample - it is a property of the two ends
  // and of nothing between them - and it is the one number that stops the far
  // country of a climbing course from climbing with the road. A course that has
  // gained twenty metres has a far edge twenty metres up if the edge follows
  // the lane, and twenty metres of ground twenty metres in the air is a slab.
  // At a third it is a hill that has stopped rising, which is a hill.
  {
    const edgeY = lerp(sm[0].y, sm[n].y, EDGE_THIRD);
    for (let i = 0; i <= n; i++) sm[i].edgeY = edgeY;
  }
  // How steep the lane is underfoot, as a rise over run. Taken over a couple of
  // metres either side rather than sample to sample, so the number a snail
  // reads is the slope it is actually on and not the facet it happens to be
  // standing on. A wall and a long ramp are both CLIMB; this is what tells the
  // sim which one it is looking at.
  for (let i = 0; i <= n; i++) {
    const a = sm[Math.max(0, i - 2)], b = sm[Math.min(n, i + 2)];
    const run = Math.max(0.5, b.x - a.x);
    sm[i].grade = (b.y - a.y) / run;
  }
  // The hillside the lane is cut into. A wall is a step in the lane, not in
  // the country: smoothing the ground level along the course means the slope
  // eases up to meet the lane over a long way instead of stepping with it, so
  // the only sheer face on a climbing course is the one the snail climbs.
  {
    const R = Math.round(20 / STEP);
    let src = sm.map((s) => s.ground);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= n; i++) {
        let sum = 0, wt = 0;
        for (let k = -R; k <= R; k++) {
          const t = 1 - Math.abs(k) / (R + 1);
          sum += src[clamp(i + k, 0, n)] * t; wt += t;
        }
        sm[i].ground = sum / wt;
      }
      if (pass === 0) src = sm.map((s) => s.ground);
    }
  }
  // the leaps, converted from the design's x into distance along the course
  const sAtX = (tx) => {
    let i = 0;
    while (i < dense.length - 2 && dense[i + 1].p.x < tx) i++;
    const a = dense[i], b = dense[i + 1];
    const u = b.p.x > a.p.x ? clamp((tx - a.p.x) / (b.p.x - a.p.x), 0, 1) : 0;
    return lerp(a.s, b.s, u);
  };
  const leaps = [];
  for (const lp of plan.leaps) {
    // a crate's `s1` is the **far end of its dish** and everything else's is the
    // foot of its far side, because a crate stands in the middle of the dish and
    // a flight lands wherever the road is. See the element for the dish.
    let s0 = sAtX(lp.x0), s1 = Math.max(sAtX(lp.x1), s0 + 0.8);
    const le = { s0, s1, land: s1 + 2.4, kind: lp.kind, vy: lp.vy, wet: lp.wet, waterY: lp.waterY, floorY: lp.floorY, lipY: lp.lipY };
    // **and the crate's own place in it.** The crate is not fitted to the groove
    // and the groove is not fitted to the crate: the crate is a cube of a fixed
    // size that has to be the same size wherever it stands, so what is measured
    // here is only *where* - the middle of the groove and the floor it sits on.
    // A cube of `CRATE_S` stands `CRATE_S` out of a groove of that depth, and
    // the snail's step onto its lid is the difference.
    if (lp.crate) {
      // **The notch is cut here, in the arc, and not in the planner's `x` - and
      // that is the whole of why.** The planner reserves the dish a length in its
      // own `x` and lays its floor over it, and the two only agree on a straight
      // road: on Crag Ascent's bend a metre and a half of design `x` came out
      // **1.68 m of arc** against a crate of 0.62, so the floor was three samples
      // long, the box stood at one end of it, and the snail walked a metre of lid
      // on nothing at all. `x` is a design coordinate and the box is a thing in
      // the world, and no amount of choosing `x` well makes one the other - the
      // same reason the half-way line is placed in `s` and the apron is opened in
      // `s`.
      //
      // **So the notch is one lane sample, and it is the one nearest where the
      // planner put it.** The floor goes on that sample and nowhere else, which
      // makes the hole exactly `STEP` of arc with the whole of the drop in the
      // gap before it and the whole of the rise in the gap after - a lip and a
      // lip, and the nearest a 750 mm lane can come to the cut face of a `leap`'s
      // chasm. Its two lips are the *midpoints* of the two gaps, because a hole
      // that stops at the sample either side of its floor is a hole half a metre
      // narrower than the gap it was cut in.
      const fc = clamp(((s0 + s1) / 2) / STEP, 0, sm.length - 1);
      const fi = Math.round(fc);
      // **The road's own level across the notch is the line between the two
      // samples that are *outside* it**, and this is the second half of what makes
      // the cut a cut. The planner lays its dish over the whole gap with the drop
      // in the middle and the rise at each end, so the samples either side of the
      // one the floor goes on are that dish's own shoulders - a fifth of a metre
      // under the road on Crag Ascent - and the old line, the average of the two
      // samples that bound the floor, averaged a dimple into the notch's depth and
      // left the dimple standing beside it. So the shoulders are found by walking
      // out to the first sample of plain road either side, and the road across the
      // notch is the straight line between those two.
      // **The two samples the lips stand on are the two the floor is between**,
      // and that is a different pair from the two the road's line is read off. The
      // lips are the boundary of the hole and the hole is one sample deep: reach
      // out to the far shoulder to measure the road and the notch on Grand
      // Marathon came out 1.12 m of arc with a metre of flat floor, twice the
      // crate it is cut for and forty centimetres of open slot showing either
      // side of the box. So the road is measured from outside and the lips are
      // cut at the samples the floor is actually between, and the two are named
      // apart so neither can be mistaken for the other.
      const a0 = Math.max(0, fi - 1), a1 = Math.min(n, fi + 1);
      let g0 = fi - 1;
      while (g0 > 0 && sm[g0].cond === PUSH) g0--;
      let g1 = fi + 1;
      while (g1 < n && sm[g1].cond === PUSH) g1++;
      const roadRun = Math.max(0.5, sm[g1].s - sm[g0].s);
      const roadAt = (s) => lerp(sm[g0].y, sm[g1].y, clamp((s - sm[g0].s) / roadRun, 0, 1));
      sm[fi].y = roadAt(sm[fi].s) - (lp.lipY - lp.floorY);
      // **and every other sample of the dish is put back on the road**, which is
      // what leaves a hole with a lip at each end instead of a hole with a trough
      // running off it. The comment above this block says the dish is cut at both
      // ends rather than eased into them, and for two samples it was not: the drop
      // was in the gap before the floor and the rise was spread over everything
      // after it, so the rise was still being drawn a fifth of a metre past the
      // far lip. A snail that misses the crate walks a step in one sample, which
      // is a lip, and the road either side of it is the road.
      for (let k = g0 + 1; k < g1; k++) {
        if (k !== fi) sm[k].y = roadAt(sm[k].s);
      }
      // and the grade of the samples it moved, because `grade` is read over
      // four samples either side and a stale one on a lip is a snail that thinks
      // the near side of a hole is a wall
      for (let k = g0; k <= g1; k++) {
        const a = sm[Math.max(0, k - 2)], b = sm[Math.min(n, k + 2)];
        sm[k].grade = (b.y - a.y) / Math.max(0.5, b.s - a.s);
      }
      le.crate = {
        s0: (sm[a0].s + sm[fi].s) / 2,
        s1: (sm[fi].s + sm[a1].s) / 2,
        restS: sm[fi].s,
        startS: (sm[a0].s + sm[fi].s) / 2 - CRATE_BACK,
        floor: sm[fi].y,
        // **and the road level at each of the two lips**, which is a thing the
        // surfaces need and cannot get for themselves: `trackAt()` between them
        // runs through the notch, so the only way to know where the road stood
        // where the walls stand is to be told, and on a course that is climbing
        // through the notch the two lips are a tenth of a metre apart and the
        // difference is the whole of whether the far lip is a step up or a
        // shelf.
        topA: roadAt((sm[a0].s + sm[fi].s) / 2),
        topB: roadAt((sm[fi].s + sm[a1].s) / 2),
      };
      s0 = le.crate.s0;
      s1 = le.crate.s1;
      le.s0 = s0; le.s1 = s1; le.land = s1 + 2.4;
    }
    leaps.push(le);
  }
  // **The apron a crate is shoved down, opened here and not in the planner**, and
  // the reason is the one the half-way line's rows are for: a row is 0.75 m apart,
  // so a width that changed at a row's own `x` is the road edge stepping a third
  // of a metre sideways between two rows 750 mm apart, which is a crease and not a
  // shoulder. Opened over `CRATE_FLARE` of the arc instead, it is a shoulder the
  // row spacing can carry - and it is read off `sm[i].w`, which is the same number
  // the verge and the scatter are already reading, so the ground opens with the
  // road and the eight boxes open with the ground.
  //
  // **And it is the whole shove that stands at the full width and not the dish**,
  // because that is where the crate is: it waits at `startS` until a snail reaches
  // it and is driven from there to `restS`, so a road that opened only across the
  // groove is a road eight boxes have already walked out of.
  for (const le of leaps) {
    if (!le.crate) continue;
    const c = le.crate;
    for (let i = 0; i <= n; i++) {
      const d = sm[i].s < c.startS ? c.startS - sm[i].s
        : sm[i].s > c.s1 ? sm[i].s - c.s1 : 0;
      if (d >= CRATE_FLARE) continue;
      sm[i].w = Math.max(sm[i].w, lerp(LANE_HW, CRATE_HW, 1 - smoothstep(0, CRATE_FLARE, d)));
    }
  }
  return {
    catId, plan, sm, n, length: len, leaps, finish: len - 20.0,
    drain: plan.cat.drain || 1,
  };
}

/** Sample the lane at a distance, interpolating position and frame. */
function trackAt(tr, s, out) {
  const t = clamp(s / STEP, 0, tr.n);
  const i = Math.floor(t), f = t - i, j = Math.min(i + 1, tr.n);
  const a = tr.sm[i], b = tr.sm[j];
  out.p.copy(a.p).lerp(b.p, f);
  out.fwd.copy(a.fwd).lerp(b.fwd, f).normalize();
  out.right.crossVectors(out.fwd, out.up).normalize();
  out.y = lerp(a.y, b.y, f);
  out.ground = lerp(a.ground, b.ground, f);
  out.w = lerp(a.w, b.w, f);
  out.water = f < 0.5 ? a.water : b.water;
  out.floor = lerp(a.floor, b.floor, f);
  out.basin = lerp(a.basin, b.basin, f);
  out.cond = f < 0.5 ? a.cond : b.cond;
  out.k = lerp(a.k, b.k, f);
  out.hill = lerp(a.hill, b.hill, f);
  out.grade = lerp(a.grade, b.grade, f);
  // `rock` is a yes or a no about a sample - a chasm floor, a wall, a crate's own
  // span - and it is carried on the frame rather than left behind for the caller
  // to look up, because the frames `roadRows()` hands out are interpolated and a
  // caller that read it off `tr.sm[]` would be reading a different sample from the
  // one it is drawing. `cond` takes the nearer of the two and so does this.
  out.rock = f < 0.5 ? a.rock : b.rock;
  out.crown = lerp(a.crown, b.crown, f);
  // the outer edge's own level, flat along the course, so it is carried as the
  // same number everywhere rather than re-read from two samples that are both
  // the same number
  out.edgeY = a.edgeY;
  // and the bend, for the same reason and with the same care: two samples a
  // long way apart in curvature average to something neither of them is, and
  // the ground reads this one to decide how far it may reach
  out.bend = a.bend === b.bend ? a.bend : (Math.abs(a.bend) > 1e5 || Math.abs(b.bend) > 1e5 ? (Math.abs(a.bend) > 1e5 ? a.bend : b.bend) : lerp(a.bend, b.bend, f));
  out.x = a.x; out.z = a.z;
  return out;
}
function newFrame() {
  return {
    p: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0), y: 0, ground: 0, w: 1.75, water: null,
    floor: 0, basin: 0, cond: RUN, k: 0, hill: 0, grade: 0, x: 0, z: 0, crown: MID_CROWN, bend: 1e6, edgeY: 0,
    rock: false,
  };
}
/** The shoreline radius: it wanders, so a pond is not a rectangle. */
function bankRadius(fr) {
  if (fr.basin <= 0.05) return 0;
  return fr.basin * (0.78 + 0.32 * vnoise(fr.x * 0.17 + 11, fr.z * 0.17 - 4));
}
/**
 * How far out from the lane the ground reaches the hillside. The verge widens
 * where the lane sits well above or below it, so a cutting or a ledge eases
 * up out of the meadow instead of standing as a cliff at the edge of the path.
 */
function vergeBand(fr) {
  // A **wall** gets the three-piece profile of `groundYAt()` below, and this is
  // its outer edge: a shelf, then a face whose width is a fraction of the drop,
  // so the rows `groundColumns()` packs into the verge land on the two turns of
  // that profile rather than somewhere out in the middle of it. A gentle height
  // is not a wall and keeps the old easing band.
  //
  // **It is read off `wallProfile()` and not written out again**, because the two
  // widths it adds together are the two widths `groundYAt()` lays the ground out
  // on, and the ground's reach and the ground's shape cannot be two numbers that
  // were written down apart. They were, once, and the rows past the toe of a face
  // landed in the middle of the face.
  const wall = wallProfile(fr);
  if (wall) return wall.shelf + wall.face;
  return fr.w + 0.6 + Math.min(9, Math.abs(fr.y - fr.ground) * 1.2);
}
/** The two widths the three-piece wall profile is built out of, shared so that
 *  `groundYAt()` and `vergeBand()` cannot fall out of step about where the turns are
 *  - the same reason `SAND()` exists on the texture side. */
const wallProfile = (fr) => {
  // **A crate's notch is a hole and not a terrace, and it is asked about before the
  // drop is.** It is first because neither of its two numbers is a function of how
  // far the lane stands above the hillside, and a guard in front of it would quietly
  // take the narrow profile away on exactly the stretch where the two levels are
  // nearest: the lane cut through a hillside at the level of the ground beside it
  // has no drop to measure, so it came out with the wide turns and the dish was back.
  //
  // The shelf exists so there is room to stand at the top of a wall, and a wall is
  // something a course climbs; the notch is six hundred and seventy long and forty
  // centimetres from this row's lane to the crest of its own rim, and a shelf and a
  // half of it laid at the floor's own level made the hole a bowl nine metres across
  // with a slot in the middle of it — the one hole on the course reading as a dish,
  // which is the thing a hole has to stop doing.
  //
  // So the ground at the floor of a notch is the lane's own width and a hand's
  // breadth, and the rim is a third of a metre further out. Both numbers are
  // about the hole rather than about the drop, which is the whole of the
  // difference: a hole is the width of what fell in it, not the height of what
  // it fell out of.
  if (fr.cond === PUSH) return { shelf: fr.w + 0.12, face: 0.3 };
  const drop = Math.abs(fr.y - fr.ground);
  if (drop <= 0.35) return null;
  return { shelf: fr.w + 1.2 + Math.min(4.5, drop * 0.35), face: Math.min(7, Math.max(0.7, drop * 0.34)) };
};
/**
 * Ground height at a lateral offset from the lane. Inside a stretch of water
 * the ground is the basin floor, rising to the shoreline at the water's edge
 * and out to the hills beyond it. Close in, the lane is cut into the
 * hillside, so the ground stays near the lane's own level.
 */
function groundYAt(fr, d) {
  const ad = Math.abs(d), w = fr.w;
  const raw = hills(fr.x, fr.z + d) - hills(fr.x, fr.z);
  const br = bankRadius(fr);
  if (br > 0.05) {
    const b0 = Math.min(br, Math.max(w + 0.2, br - 2.7));
    // the basin itself, as it stands where there is no lane above it
    const basinY = (dd) => (dd <= br
      ? lerp(fr.floor, fr.ground, easeInOut(clamp((dd - b0) / Math.max(0.25, br - b0), 0, 1)))
      : lerp(fr.ground, fr.ground + raw, smoothstep(br + POOL_BERM, br + POOL_BERM + 7, dd)));
    // The lane stands **on** the bank; it does not stand in the water. Where the
    // lane is above the waterline - the lip you launch off, the wall you climb
    // out on - the ground under it is the lane's own ground, and past the edge
    // of the lane it **eases down to the bank** rather than stopping dead.
    //
    // Both halves of that are the whole of this function's business in a gorge.
    // Returning the floor for every sample inside the basin put three metres of
    // air under the lip, and the road at the top of a leapClimb was a plate
    // with daylight under the middle of it. Stopping the lane's ground *at* the
    // edge of the lane was half a fix and it is worse than it sounds: it made
    // the whole of the wall out of the chasm a two-and-a-bit metre wide shelf
    // with a vertical face on either side, so a steep climb reads as a flight
    // of flat plates stacked against a cliff - a step and a slab, a step and a
    // slab - which is what the far bank of a leapClimb looked like until the
    // ease was here. The ease is what makes the road a cutting **in** a bank
    // rather than a ledge stuck on the side of one.
    //
    // The shoulder is a multiple of the drop and not a fixed distance, so a
    // half-metre step out of the water gets a gentle metre of bank and a
    // three-metre one gets a face at about fifty degrees - still a cliff, and no
    // longer a wall.
    //
    // It is a guard on the water and not on the floor, and that is deliberate. A
    // **pool** you swim across has its lane at the water's own level, so the
    // clause does not fire and the ground under it is the floor and the water
    // has a depth.
    if (fr.water != null && fr.y > fr.water + 0.04) {
      const drop = Math.max(0, fr.y - basinY(w));
      const sh = w + Math.min(3.4, Math.max(0.9, drop * 0.8));
      return lerp(fr.y - 0.06, basinY(Math.max(ad, sh)), smoothstep(w, sh, ad));
    }
    return basinY(ad);
  }
  if (ad <= w) return fr.y - 0.06;
  // **A wall is a step, and the old shape drew it as a ramp.** The ground used to
  // ease from the lane's own level to the terrain across one band, and that band
  // was a straight line - so a four-metre wall came out as five metres of
  // thirty-six-degree hillside with the road lying on top of it. A climbing course
  // is made of walls, and this made the one thing the course is *about* stop
  // looking like a wall at exactly the point where the snail is asked to climb it:
  // the road ran out into a rounded slope, and a slope is a thing you walk up, not
  // a thing you climb.
  //
  // So it is three pieces and the middle one is short and **straight**:
  //
  //   - a **shelf** at the lane's own level, a terrace wide enough to stand on and
  //     scaling with the height of the wall, because the top of a tall wall has a
  //     wider top on it;
  //   - a **face** whose width is a third of the drop, so it stands at fifty to
  //     seventy degrees however tall the wall is - and it is a **plane**, not a
  //     smoothstep, because a smoothstep rounds both ends of it and a rounded end
  //     is the whole of what went wrong. The lip at the top and the toe at the
  //     bottom are creases, and a crease is what makes a face read as a face under
  //     a nine-degree sun;
  //   - and then the country, easing out of the foot of it exactly as it did.
  //
  // The same profile is a **cutting** when the lane is below the terrain, and that
  // is the point: the sign of the drop is not consulted, so a road cut into a
  // hillside gets a bank and a road perched on one gets a face, and neither of
  // them is a lump. A gentle height is not a wall at all and keeps the old band.
  const wall = wallProfile(fr);
  if (wall) {
    if (ad <= wall.shelf) return fr.y - 0.06;
    const foot = wall.shelf + wall.face;
    if (ad <= foot) return lerp(fr.y - 0.06, fr.ground, (ad - wall.shelf) / wall.face);
    return farCountry(fr, d, lerp(fr.ground, fr.ground + lerp(clamp(raw, -2.6, 2.2), raw, smoothstep(foot, foot + 6, ad)), smoothstep(foot, foot + 11, ad)));
  }
  const band = vergeBand(fr);
  if (ad <= band) return lerp(fr.y - 0.06, fr.ground, (ad - w) / (band - w));
  return farCountry(fr, d, lerp(fr.ground, fr.ground + lerp(clamp(raw, -2.6, 2.2), raw, smoothstep(band, band + 6, ad)), smoothstep(band, band + 11, ad)));
}
/**
 * How far out the ground is drawn, and it is **one number for the whole
 * ribbon**, not one per side.
 *
 * It is *asked of the frame rather than written down*, because the row list and
 * the height have to finish in the same place. The last row of a side is the
 * outermost thing there is, and the ease down to the terrain has to be *complete
 * there*: left short, the ground's edge stands wherever the ribbon happened to
 * be, which on a climbing course is a foot in the air. One number, two callers,
 * and the one thing that is not allowed is for them to be written down twice -
 * they were, and the two drifted to a hundred and twenty and two hundred and
 * sixty at the same time.
 *
 * **The cap is on both sides, and it is the sign that put it on the wrong one.**
 * A ground row is an offset of the lane, and an offset run out past the radius
 * of the bend it was taken from comes back on itself: the row on the inside of
 * a corner wraps through its own centre and the ground behind it folds over the
 * ground in front of it. On Hedgerow Dash that was the notch in the middle of
 * the meadow's outline - and it was the *uncapped* side that did it, because
 * which side a bend folds is carried by the sign of `sm.bend`, and a positive
 * one does not mean what the note on the field said it meant. The trim went one
 * way and the fold went the other, and from a hundred metres up a ribbon whose
 * left edge doubles back through a hundred and seventy-nine degrees is a bite
 * out of the country.
 *
 * So the cap does not ask which way the bend goes. It asks how tight the
 * **tightest** bend in reach is, and it holds **both** sides inside that, which
 * is one number instead of two and is the only version in which neither side
 * can fold. It costs the outside of a corner the country it could have had: a
 * hundred and twenty is a hundred and twenty on both sides of a corner whose
 * radius is seventy, where the outside would have gone to a hundred and
 * twenty-six. It is a meadow, not a survey.
 */
function groundEdge(fr) {
  // the lesser of the two ceilings, and the edge is not optional: a bend of
  // nine hundred metres is a straight line with a name on it, and a cap that is
  // only the radius puts the edge at eight hundred and fifty
  return Math.min(gfxEdge(), Math.max(gfxGroundFloor(), Math.abs(fr.bend) * NEST_FRACTION));
}
/**
 * Out past the verge the ground is the lane's own level carrying the country's
 * relief, and that is right near the road - but the lane's level is **not the
 * country's**, and the two come apart the further the course climbs.
 *
 * `fr.ground` is the lane's ground, smoothed along the course, and the plan
 * hands a running section the lane's own height: the country beside a climbing
 * course is meant to climb with the road rather than fall away from it under a
 * viaduct. So a course that has gained twenty metres carries its whole ribbon
 * twenty metres with it - and the ribbon runs out a hundred and fifty metres
 * either side, so the whole of it hangs in the air with the weather underneath
 * it. On Crag Ascent, whose half-way is twenty metres above the meadow, that
 * was a green slab the length of the course suspended over the valley, which is
 * the overhang, and it was never the sweep's fault: the sweep only ever moved
 * where the slab was, not how high it hung.
 *
 * So the far country is given back to the terrain. `far` is the ground as it
 * was - the lane's level plus the relief - and the last stretch of it eases
 * down to `hills()` at the same point, which is where the ribbon's outer
 * columns are (`gfxEdge()`, and the two numbers have to be the same number:
 * ease that finishes short of the edge and the last strip of ground hangs a
 * metre above the country, and a ribbon in the air has a skyline). On a
 * meadow course the two are within a couple of metres and the ease is
 * invisible; on a climbing course it is the hillside falling away, which is
 * what a course that has climbed twenty metres should look like from above.
 */
const farCountry = (fr, d, far) => {
  const ad = Math.abs(d);
  // The far country settles to the lesser of the real terrain and the level a
  // third of the way between the heights the course starts and finishes at. The
  // terrain is the one that matters - it is the ground that is actually there -
  // and the ramp is the cap: on a course that has climbed twenty metres, the
  // ground at the far edge rises at a third of the rate the road did, so the
  // countryside falls away behind it instead of climbing up to meet the road and
  // folding back over the course. It is `min` and not a blend, because a blend
  // would put the ground *above* the terrain wherever the ramp is higher, and a
  // ribbon above the terrain is a slab in the air - which is the thing this
  // whole piece of work is about not having.
  return lerp(far, Math.min(hills(fr.x, fr.z + d), fr.edgeY), smoothstep(49, groundEdge(fr), ad));
};
function lanePoint(tr, s, d, out) {
  trackAt(tr, s, out);
  out.p.addScaledVector(out.right, d);
  return out;
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
// ------------------------------------------------------------------
// The lane and the ground under it. The five constants go with them
// because each is the arithmetic of a function in this file, and a
// constant exported on its own is a number two modules from its own
// explanation. **The half-way is not here** - `src/surfaces.js` says why
// in the terms that decided it, and the short version is that it reads
// `groundDrawnAt()`.
// ------------------------------------------------------------------
export {
  buildTrack, trackAt, newFrame, bankRadius, vergeBand, wallProfile,
  groundYAt, groundEdge, farCountry, lanePoint,
  BEND_BASIS, gfxBendReach, NEST, NEST_FRACTION, EDGE_THIRD,
};
