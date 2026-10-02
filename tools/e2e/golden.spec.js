// golden.spec.js - the numbers, against the file captured off the pre-split game.
//
// This is the half of the suite that can fail on something invisible. A smoke
// test cannot tell a reordered module from a reordered race, and a reordered
// race is exactly what eleven files invite: the county is one long ordered
// argument - planned, then built, then raced - and every file that is moved is
// a chance to break the order without breaking anything that throws.
//
// So the comparison is deep and the tolerances are zero. A course's lane is every
// eighth sample to four decimals, its plan's design line to four, the terrain
// either side of it at six distances out, and a whole simulated race's finishing
// order and times to six. Nothing here is compared with a percentage, because a
// percentage is a number that lets a real change through.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from 'playwright/test';
import { boot, noErrors } from './fixtures.js';
import { COURSES } from './tier.js';

const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline.json'), 'utf8'));

/** The whole per-course capture, from a page that has just booted. */
const CAPTURE = (catId) => {
  const S = window.__snail;
  // **`x || 0` on the way out**, and that is not tidiness: `(-0.00004).toFixed(4)`
  // is `-0.0000`, and `JSON.stringify(-0)` is `0`, so a baseline on disk can
  // never come back as the negative zero the page still holds.
  const r4 = (v) => (v == null || !isFinite(v) ? null : (+v.toFixed(4) || 0));
  const plan = S.plan(catId);
  const tr = S.track(catId);
  const lane = [];
  for (let i = 0; i <= tr.n; i += 8) {
    const q = tr.sm[i];
    lane.push([r4(q.s), r4(q.y), r4(q.ground), r4(q.w), r4(q.water), r4(q.floor),
      r4(q.basin), r4(q.crown), r4(q.grade), r4(q.bend), q.cond, q.rock ? 1 : 0]);
  }
  const fr = S.newFrame();
  const ground = [];
  const stride = Math.max(1, Math.floor(tr.n / 8));
  for (let i = 0; i <= tr.n; i += stride) {
    S.trackAt(tr, tr.sm[i].s, fr);
    ground.push([r4(tr.sm[i].s), r4(fr.y), r4(fr.ground),
      ...[-40, -18, -7, 7, 18, 40].map((d) => r4(S.groundYAt(fr, d)))]);
  }
  return {
    plan: {
      length: r4(plan.length), midX: r4(plan.midX), tally: plan.tally,
      pts: plan.pts.map((p) => [r4(p.x), r4(p.y), r4(p.z)]),
      meta: plan.meta.map((m) => [m.cond, r4(m.ground), r4(m.w), r4(m.water),
        r4(m.floor), r4(m.basin), r4(m.crown), m.rock ? 1 : 0]),
      leaps: plan.leaps.map((l) => [l.kind, r4(l.x0), r4(l.x1), r4(l.farX), r4(l.lipY),
        r4(l.laneY), r4(l.waterY), r4(l.floorY), r4(l.vy), l.wet ? 1 : 0, l.crate ? 1 : 0]),
    },
    track: {
      catId: tr.catId, n: tr.n, length: r4(tr.length), finish: r4(tr.finish), drain: r4(tr.drain),
      leaps: tr.leaps.map((l) => [l.kind, r4(l.s0), r4(l.s1), r4(l.land), r4(l.lipY),
        r4(l.laneY), r4(l.waterY), r4(l.floorY), r4(l.vy), l.wet ? 1 : 0]),
      lane, ground,
    },
  };
};

for (const id of COURSES) {
  test(`${id}: the plan, the lane and the terrain either side of it`, async ({ page }) => {
    const { errors } = await boot(page);
    const got = await page.evaluate(CAPTURE, id);
    const want = BASELINE.courses[id];
    expect(got.plan.length, `${id} plan length`).toBe(want.plan.length);
    expect(got.plan.tally, `${id} what it asked for`).toEqual(want.plan.tally);
    // the design line, sample for sample: a planner in the wrong module, or the
    // wrong noise in the right one, moves this and nothing else
    expect(got.plan.pts, `${id} design line`).toEqual(want.plan.pts);
    expect(got.plan.meta, `${id} section fields`).toEqual(want.plan.meta);
    expect(got.plan.leaps, `${id} the gaps as planned`).toEqual(want.plan.leaps);
    // and the lane, which is where the plan is turned into a distance
    expect(got.track.length, `${id} track length`).toBe(want.track.length);
    expect(got.track.n, `${id} samples`).toBe(want.track.n);
    expect(got.track.finish, `${id} finish`).toBe(want.track.finish);
    expect(got.track.leaps, `${id} the gaps in arc`).toEqual(want.track.leaps);
    expect(got.track.lane, `${id} the lane`).toEqual(want.track.lane);
    // **and the ground, which no other number here can see.** `groundYAt()` is a
    // function of the frame it is handed, and a frame read off the wrong row is a
    // hillside in the wrong place with the lane above it exactly where it was.
    expect(got.track.ground, `${id} terrain off the lane`).toEqual(want.track.ground);
    noErrors(errors);
  });
}

for (const id of COURSES) {
  test(`${id}: a whole race, simulated, and what is standing on it`, async ({ page }) => {
    const { errors } = await boot(page);
    const got = await page.evaluate((catId) => {
      const S = window.__snail;
      S.surge(false);
      S.start(catId);
      const r = S.sim(300, 0.04);
      S.surge(false);
      return {
        place: S.race.player.place, points: S.race.player.points,
        time: +r.time.toFixed(6), length: +r.length.toFixed(4), hour: +r.hour.toFixed(6),
        field: r.field.map((f) => [f.name, f.place, f.points, +f.time.toFixed(6), f.rating]),
        standing: S.standing(),
        mills: S.mills(),
      };
    }, id);
    const want = BASELINE.courses[id].sim;
    expect(got.time, `${id} your time`).toBe(want.time);
    expect(got.place, `${id} where you came in`).toBe(want.place);
    // the whole field, in order, with its own times: a sim that drifted by a
    // frame would still put you in the same place
    expect(got.field, `${id} finishing order`).toEqual(want.field);
    // **what is standing, and the yards.** The register is emptied and refilled
    // by `buildCourse()` in an order the docs call load-bearing, so this is the
    // scenery half of the split: same pieces, same clearings, same overlap.
    expect(got.standing, `${id} what is standing`).toEqual(want.standing);
    expect(got.mills, `${id} the windmills`).toEqual(want.mills);
    noErrors(errors);
  });
}


for (const id of COURSES) {
  test(`${id}: every jump stands on a lip that reaches its launch height`, async ({ page }) => {
    const { errors } = await boot(page);
    // **The tell the repo documents, and it is not in `plan-test.mjs` whatever
    // the docs say - it is here.** A leap's lip used to be smoothed off into a
    // slope that never reached the launch height, because the floor of a chasm
    // under a *pool* is `FLY` and the floor under a dry gap is `WALK`, and the
    // ridge filter guarded only the first. It read 0.56 to 0.90 m low on every
    // dry gap, and nothing caught it because the sim always flew from the
    // *planned* height: the road was sitting below where the snail launched
    // from, which is a smaller jump than it looks and not a wrong one.
    //
    // So this is a check on the road and not on the plan.
    const lips = await page.evaluate((catId) => {
      const S = window.__snail;
      const tr = S.track(catId);
      return tr.leaps.map((le) => {
        // **A crate is not in here, and that is not a gap in the check.** A
        // `pushCrate`'s lip is a dish cut in the road with a box standing in
        // it, so the crest of that stretch is the road coming up to the dish
        // and it is meant to be *higher* than it - Crag Ascent's came out
        // 200 mm above. The crate's own arithmetic is the notch, and
        // `tools/plan-test.mjs <course> --leaps` is where that is measured.
        if (le.kind === 'pushCrate') return null;
        // the lip's own `s` falls between two lane samples - by up to half a
        // 750 mm stride - so the crest is the highest of the three around it
        const i = Math.round(le.s0 / 0.75);
        let crest = -Infinity, at = i;
        for (let k = i - 1; k <= i + 1; k++) {
          if (tr.sm[k].y > crest) { crest = tr.sm[k].y; at = k; }
        }
        return {
          kind: le.kind, s0: +le.s0.toFixed(4), lipY: +le.lipY.toFixed(4),
          crest: +crest.toFixed(4), ahead: +(tr.sm[at + 1].y - crest).toFixed(4),
        };
      }).filter(Boolean);
    }, id);
    expect(lips.length, `${id} jumps`).toBe(
      BASELINE.courses[id].track.leaps.filter((l) => l[0] !== 'pushCrate').length);
    for (const l of lips) {
      const where = `${id} ${l.kind} at s=${l.s0}`;
      // **A tenth of a metre, and the number is not arbitrary.** The crest of a
      // lip that is exactly right still misses the planned height by up to half
      // a stride of the lane's own rise, because the lip is not on a sample.
      // The measured spread across the county is 83 mm, and a lip that had been
      // rounded off reads 0.56 to 0.90 low, so the bound has six times the
      // margin over the failure it is for.
      expect(Math.abs(l.crest - l.lipY), `${where}: crest ${l.crest} against a lip of ${l.lipY}`)
        .toBeLessThan(0.1);
      // **and the lane drops away on the far side**, which is what makes a lip a
      // crease and not the top of a trough. It fell by 82 mm to 670 mm on every
      // jump in the county; a lip that fell by a millimetre is a dish.
      expect(l.ahead, `${where}: the lane past the lip`).toBeLessThan(-0.05);
    }
    noErrors(errors);
  });
}

test('the tier is the one the baseline recorded, and the chain is built and torn down on its edge', async ({ page }) => {
  const { errors } = await boot(page);
  const at = async () => page.evaluate(async () => {
    // **Two frames, and that is the whole of why the course has to be standing
    // before anything is counted.** The first draw of a course allocates
    // eighteen textures of its own - a shadow map among them - so a count taken
    // before one is the count of an empty stage, and comparing it against a
    // count taken after reads a leak that is the course's own floor.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const i = window.__snail.info();
    return { targets: i.targets, passes: i.passes, samples: i.samples, rt: i.rt, canvas: i.canvas };
  });
  // the pinned tier, exactly as captured
  expect(await at()).toEqual({
    targets: BASELINE.info.targets, passes: BASELINE.info.passes, samples: BASELINE.info.samples,
    rt: BASELINE.info.rt, canvas: BASELINE.info.canvas,
  });

  // **The course goes up first**, because the chain has to draw something and
  // because the floor its targets are counted against is the floor a standing
  // course makes.
  await page.evaluate(() => window.__snail.start('sky'));
  const floor = await at();
  expect(floor.passes, 'the direct path with a course standing').toEqual([]);

  // **across the edge and back, twice.** `needsComposer()` is a predicate and
  // the chain is built on its false->true edge and disposed on its true->false
  // one, and eight functions in the post chain read the scenes through the
  // registry - so this is the step that shows a missed one, and doing it twice
  // is what makes it a leak test rather than a build test.
  const after = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => window.__snail.setGfx('render', 1));
    const up = await at();
    expect(up.passes.length, `cycle ${cycle}: the chain is there when it is wanted`)
      .toBeGreaterThan(0);
    expect(up.rt, `cycle ${cycle}: the chain's own buffer, a share of the canvas`)
      .not.toBeNull();
    expect(up.canvas, `cycle ${cycle}: the canvas did not change; the county did`)
      .toEqual(BASELINE.info.canvas);
    const drawn = await page.evaluate(() => window.__snail.info());
    expect(drawn.glError, `cycle ${cycle}: glError on the composer path`).toBe(0);
    expect(drawn.badProgram, `cycle ${cycle}: programs that did not compile there`).toEqual([]);
    expect(drawn.calls, `cycle ${cycle}: draw calls through the composer`).toBeGreaterThan(0);

    await page.evaluate(() => window.__snail.setGfx('render', 3));
    const down = await at();
    expect(down.passes, `cycle ${cycle}: the chain is gone when it is not wanted`).toEqual([]);
    expect(down.samples, `cycle ${cycle}: no multisample target is left`).toBe(0);
    expect(down.targets, `cycle ${cycle}: the chain's targets were disposed`)
      .toBe(floor.targets);
    after.push(down.targets);
  }
  // and the two cycles agreed with each other, which is the half a build-once
  // check cannot see: a chain that keeps a target of four each time it is torn
  // down still disposes on the first pass
  expect(after[1], 'the second cycle disposed as much as the first').toBe(after[0]);
  noErrors(errors);
});
