/**
 * The track planner, run on its own in node.
 *
 *   node tools/plan-test.mjs                 every course, a few seeds
 *   node tools/plan-test.mjs sky 11 777      one course, these seeds
 *   node tools/plan-test.mjs sky 11 --leaps  and the gaps in detail
 *
 * The planner is imported straight out of `src/plan.js`, so what is printed here
 * is what the game would build, without a browser, a save file or a season you
 * are allowed into. It is the way to check a course or a new obstacle: how long
 * it comes out, what it asks of you in order, and how big each gap, lip, wall
 * and puddle actually is.
 *
 * **This used to read `snail-race.js` as text**, regex for a declaration, guess
 * where it ends, and concatenate twenty-eight hand-listed names onto a shim
 * that redefined `clamp`, `lerp` and `smoothstep` and carried a stub
 * `class Vector3`. Its own header used to record how that heuristic mistook a
 * one-line constant for a block and gave itself a second `LEVEL_Y`, and the
 * sixty lines of shim were the price of testing a re-typed copy of the planner
 * rather than the planner.
 *
 * The import works because of two things that are in the modules rather than
 * here. `plan.js` holds no three.js - its design points are plain `{x, y, z}`
 * objects, and nothing calls a method on one - and `core.js` reads
 * `races.json` and `seasons.json` off the disk when there is no `document`, so
 * `CAT_BY_ID` is populated in a node process. Both of those are load-bearing for
 * this file and neither is about this file.
 *
 * **And the numbers this prints went up, because the scraper had the courses
 * before they were scaled.** It read `races.json` itself and never applied a
 * course's own `scale`, so it planned Grand Marathon at 211 m of budget where
 * the game builds 358.7 - a different course, not a shorter version of the same
 * one, and on seed 11 the two do not agree even on what they ask of you: three
 * crates and two leaps against two crates and one. `core.js` loads the file,
 * multiplies `len` by `scale` and hands out the courses the game builds, so this
 * is now the same five courses the five races are. Dash came out 179.7 m where
 * it said 154.8.
 *
 * What this still does not model is the **season**: it passes `lenScale` of 1,
 * and a season multiplies that on top - 0.8 in the Sunday Cup, 2.3 in the Snail
 * GP - so these are the courses at their own length and not the ones a particular
 * tier asks for. A gap is the same gap either way, which is what the `--leaps`
 * lines are for; a length is not.
 */
import { planTrack } from '../src/plan.js';
import { CATS, CRATE_S, CRATE_BACK, CRATE_LANE } from '../src/core.js';

const NAME = ['RUN', 'CLIMB', 'SWIM', 'FLY', 'WALK', 'PUSH'];
const args = process.argv.slice(2);
const only = args[0] && !/^\d/.test(args[0]) ? args[0] : null;
const seeds = (args.filter((a) => /^\d/.test(a)).length ? args.filter((a) => /^\d/.test(a)) : [11, 777]);
const detail = args.includes('--leaps');
for (const cat of CATS) {
  if (only && cat.id !== only) continue;
  for (const seed of seeds) {
    const plan = planTrack(cat.id, seed, 1);
    const seq = [];
    for (const m of plan.meta) {
      if (!seq.length || seq[seq.length - 1][0] !== m.cond) seq.push([m.cond, 1]);
      else seq[seq.length - 1][1]++;
    }
    console.log('\n' + cat.id + '  seed ' + seed + '  ' + plan.length.toFixed(1) + ' m  ' + JSON.stringify(plan.tally));
    console.log('  ' + seq.map(([c, n]) => NAME[c] + '×' + n).join(' '));
    if (detail) {
      for (const lp of plan.leaps) {
        const line = '  ' + lp.kind.padEnd(10)
          + ' gap ' + (lp.x1 - lp.x0).toFixed(2)
          + '  lip above lane ' + (lp.lipY - lp.laneY).toFixed(2)
          + (lp.waterY == null ? ''
            : '  water below lane ' + (lp.laneY - lp.waterY).toFixed(2)
              + '  deep ' + (lp.waterY - lp.floorY).toFixed(2));
        console.log(line);
        // and a crate's own arithmetic, which is the two numbers that make it a
        // crate rather than a hazard. **The flat middle of the dish is half its
        // length and the cube stands on it**, so the step up onto the lid is the
        // cube less the depth of the dish, and the quarter at each end is a ramp
        // the snail walks down and up rather than a wall it climbs out of.
        //
        // **Every number on that line is the plan's own and not the road's**, and
        // the one to be careful of is the flat middle: it is half the dish in
        // design x, and the dish is not what gets drawn. A crate's notch is cut
        // in the arc, one lane sample deep, with four rows of its own either side
        // of each lip, so what the road is given is STEP of arc — 0.75 m — and
        // 0.67 m of flat floor in it, whatever this line says the middle is.
        if (lp.crate) {
          const open = lp.x1 - lp.x0, far = lp.farX - lp.x1;
          console.log('      crate: dish ' + (open + far).toFixed(2) + ' in design x'
            + '  dip ' + open.toFixed(2) + '  far run ' + far.toFixed(2)
            + '  flat middle ' + ((open + far) / 2).toFixed(2) + ' in x against a cube of ' + CRATE_S.toFixed(2)
            + '  dish ' + (lp.lipY - lp.floorY).toFixed(2) + ' deep'
            + '  step onto the lid ' + (CRATE_S - (lp.lipY - lp.floorY)).toFixed(2)
            + '  road wanted in front ' + (CRATE_BACK + 0.56).toFixed(2) + ' m, floor ' + CRATE_LANE.toFixed(2) + ' in x');
        }
      }
    }
  }
}
