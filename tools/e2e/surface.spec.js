// surface.spec.js - the ground never stands above the lane.
//
// Two assertions on one rule, and the rule is the one the ribbon's own geometry
// is built on: **every vertex of the road is at the lane's own level and spans
// `|d| <= w`, and every vertex of the ground inside that width has to be under
// it.** A ground that answers higher than the lane anywhere on the lane's own
// width is a band of terrain lying across the road, and it is not a seam and not
// a colour - it is one surface drawn over another with the depth test doing
// exactly what it was asked to.
//
// **This is not a picture and no assertion about a picture could have found it.**
// The clip it exists for was **0.370 m of meadow across the whole width of Lily
// Deep's road, a quarter of a metre long, at the exit of each of the course's
// four pools** - a step in the ground you walk on, not a hole in the mesh. Read
// as a landscape it is a berm, and the four of them are at four places a course
// is supposed to have a berm.
//
// The cause is worth a line, because the rule reads as if it could not have been
// broken: `groundYAt()` answers inside a basin with `basinY()`, which is the
// **floor** at the centre line and the country's own level a metre out. That is
// right for a stretch of lane a snail swims across and wrong for every other
// stretch that has a basin, and the guard in front of it - `fr.water != null &&
// fr.y > fr.water + 0.04` - only asked about the water. The basin's radius is
// stamped over a pool's whole gap and the water over the part of that gap the
// water is in, so the two do not end together: at the exit of a pool there is a
// stretch where the basin is still a basin and the water has already run out, and
// on Lily Deep that stretch is **6.06 down to 0.16** of a radius over a quarter
// of a metre of lane. `buildWater()` has always asked the other question
// (`wy === null` skips the run) and the ground did not.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from 'playwright/test';
import { boot, noErrors } from './fixtures.js';

const HERE = __dirname;
/** The roster off disk rather than a list written here: a course that exists and
 *  is not in this array is a course nothing in the suite ever looks at, which is
 *  the arrangement this file exists to end. `races.json` is the county's own
 *  list and `__snail.track()` wants one of its ids. */
const COURSES = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'races.json'), 'utf8'))
  .map((c) => c.id);

/** How far above the road a drawn vertex may stand, in metres.
 *
 *  **Two millimetres, and it is a measurement rather than a tolerance.** The
 *  surfaces are built from the same row list and the same frame, so a ground
 *  vertex inside the ribbon's width is `fr.y - 0.06` by construction and the two
 *  never come within a millimetre of each other there; the epsilon is here
 *  because the second assertion raycasts against triangles rather than reading
 *  the profile, and a ray's hit point is a division. */
const OVER = 0.002;

/** The rule, then the meshes.
 *
 *  The first is cheap and is the one that names the bug: it reads
 *  `groundYAt()` at the lane's own width on every row of every course, so it
 *  catches the failure the day the profile changes rather than the day somebody
 *  walks a pool exit and looks at it. The second is the answer as the player
 *  gets it - three meshes built, and a ray dropped down every ground and flank
 *  vertex to ask what the road is doing underneath it - and it is the half that
 *  can see a ground vertex folded back across the lane from a tight bend, which
 *  is a clip the first cannot.
 *
 *  **`buildGround()` and friends are reached by importing `/src/surfaces.js`**
 *  rather than off `window.__snail`, and that is not a convenience: the game has
 *  already loaded that exact URL, so the module registry hands back the same
 *  module instance and these are the game's own meshes off the game's own track
 *  - the same numbers `buildCourse()` builds, and not a second copy of the
 *  course. A dynamic `import()` of the spec's own copy of the file would be a
 *  second county with its own `rand()` stream and its own module-scope state.
 */
async function surfaceReport(page) {
  return page.evaluate(async (ids) => {
    const THREE = await import('three');
    const surf = await import('/src/surfaces.js');
    const S = window.__snail;
    const out = {};
    for (const id of ids) {
      const tr = S.track(id);

      // the rule: the profile, on every row the three surfaces are laid from
      let worstRule = -Infinity;
      let worstAt = null;
      const fr = S.newFrame();
      for (const row of surf.roadRows(tr)) {
        const sm = surf.rowFrame(tr, row, fr);
        // the three columns the ground mesh actually has inside the ribbon, and
        // the quarter and nine-tenths either side of them, because the drawn
        // ground is a straight line between two columns and a profile that
        // touches the lane half way across the gap is a clip half way across it
        for (const t of [0, 0.5, 0.9, 0.99, 1]) {
          for (const sign of t === 0 ? [1] : [1, -1]) {
            const over = S.groundYAt(sm, sign * t * sm.w) - sm.y;
            if (over > worstRule) {
              worstRule = over;
              worstAt = { s: +row.s.toFixed(2), d: +(sign * t * sm.w).toFixed(2),
                water: sm.water, basin: +sm.basin.toFixed(3) };
            }
          }
        }
      }

      // the meshes: what the player gets
      const road = surf.buildRoad(tr);
      const gnd = surf.buildGround(tr);
      const skirt = surf.buildSkirt(tr);
      const rc = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const p = new THREE.Vector3();
      const over = (arr) => {
        let n = 0, worst = 0, at = null;
        for (let i = 0; i < arr.length; i += 3) {
          // from high above, so a vertex that is *under* the road's own row
          // cannot shadow the one beside it; 80 m is past the county's highest
          // lane and under nothing but the dome
          p.set(arr[i], arr[i + 1] + 80, arr[i + 2]);
          rc.set(p, down);
          const hit = rc.intersectObject(road, false);
          if (!hit.length) continue;
          const d = arr[i + 1] - hit[0].point.y;
          if (d > 0.002) {
            n++;
            if (d > worst) { worst = d; at = [+arr[i].toFixed(2), +arr[i + 1].toFixed(3), +arr[i + 2].toFixed(2)]; }
          }
        }
        return { n, worst: +worst.toFixed(3), at };
      };
      out[id] = { rule: +worstRule.toFixed(4), ruleAt: worstAt,
        ground: over(gnd.geometry.attributes.position.array),
        flank: over(skirt.geometry.attributes.position.array) };
      road.geometry.dispose(); gnd.geometry.dispose(); skirt.geometry.dispose();
    }
    return out;
  }, COURSES);
}

test('the ground is under the lane everywhere on the lane, on every course', async ({ page }) => {
  const { errors } = await boot(page);
  const report = await surfaceReport(page);
  noErrors(errors);

  // **Every course is walked, and not a named one.** The clip shipped on the two
  // courses with the most pools and would have been found on either, and a gate
  // that names them is a gate that reports a course nobody thought about as
  // having no opinion - which is the failure this whole file is written against.
  expect(Object.keys(report)).toEqual(COURSES);

  for (const id of COURSES) {
    const r = report[id];
    // **The rule, at `fr.y` itself and not at `fr.y - 0.06`.** The six
    // centimetres are the road's own thickness under the ribbon and are not the
    // thing at stake; the thing at stake is the ground coming up past the lane's
    // own level at all, which is what a band of meadow lying across the road is.
    expect(r.rule, `${id}: ground above the lane on its own width`).toBeLessThanOrEqual(0);
    expect(r.ground.n, `${id}: ground vertices standing over the road`).toBe(0);
    expect(r.flank.n, `${id}: flank vertices standing over the road`).toBe(0);
    expect(r.ground.worst, `${id}: worst ground over the road`).toBeLessThanOrEqual(OVER);
    expect(r.flank.worst, `${id}: worst flank over the road`).toBeLessThanOrEqual(OVER);
  }
});