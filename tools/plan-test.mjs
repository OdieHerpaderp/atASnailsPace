/**
 * The track planner, run on its own in node.
 *
 *   node tools/plan-test.mjs                 every course, a few seeds
 *   node tools/plan-test.mjs sky 11 777      one course, these seeds
 *   node tools/plan-test.mjs sky 11 --leaps  and the gaps in detail
 *
 * The planner is lifted straight out of snail-race.js by name, so what is
 * printed here is what the game would build, without needing a browser, a
 * save file or a season you are allowed into. It is the way to check a course
 * or a new obstacle: how long it comes out, what it asks of you in order, and
 * how big each gap, lip, wall and puddle actually is.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
// **Two files, because the game is two files now.** `core.js` came out of the
// game first and it took the tuning table and the noise with it, and this tool
// finds a declaration by reading text - so a name that moved is a name it cannot
// find, and the gate that exists to catch exactly that is the one tool that
// breaks. The search is the union rather than the game alone, which is enough to
// keep every step green until the import below replaces all of this.
const SOURCES = ['src/core.js', 'snail-race.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n'));

/** Pull a top-level declaration out of the game by name, braces and all. */
function grab(name) {
  let lines = null, at = -1;
  for (const src of SOURCES) {
    for (let i = 0; i < src.length; i++) {
      const l = src[i];
      if (new RegExp('^(export )?(async )?(function|const|let|class) ' + name + '\\b').test(l)
        || new RegExp('^(export )?const ' + name + ' =').test(l)) { lines = src; at = i; break; }
    }
    if (at >= 0) break;
  }
  if (at < 0) throw new Error('not in the game: ' + name);
  // a declaration that ends in a semicolon on its own line is one whole thing,
  // and so is one the next line starts a new top-level statement after. The
  // semicolon test reads the line **without its trailing comment**, because the
  // county writes a number and then says what the number is on the same line,
  // and a one-line constant lifted by name used to be taken for a block that
  // ran on to the next top-level brace - which is how this tool grew a second
  // `LEVEL_Y` and a `SyntaxError` in its own shim.
  const bare = lines[at].replace(/\s*\/\/.*$/, '');
  if (/;\s*$/.test(bare) || /^(\}|function|const|let|class|export)\b/.test(lines[at + 1] || '')) {
    return lines[at] + '\n';
  }
  // otherwise it ends at the first line that closes it at the left margin
  for (let i = at + 1; i < lines.length; i++) {
    if (/^[)}\]]/.test(lines[i])) return lines.slice(at, i + 1).join('\n') + '\n';
  }
  throw new Error('no end found for ' + name);
}

const shim = `
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CATS = JSON.parse(fs.readFileSync(path.join(ROOT, 'races.json'), 'utf8'));
const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (x) => x * x * (3 - 2 * x);
// the planner only ever makes points
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
const THREE = { Vector3 };
`;

// only what the planner itself reaches for, in the order it needs it
const WANTED = [
  'RUN', 'LEVEL_Y', 'POOL_BANK', 'POOL_SPREAD', 'STEP',
  'CRATE_S', 'CRATE_X', 'CRATE_BACK', 'CRATE_LANE', 'LANE_HW',
  'MID_SPAN', 'MID_CROWN', 'MID_MIN', 'MID_BAND', 'BAND_MIN', 'BAND_MAX', 'BAND_FINISH', 'RUN_IN_MIN', 'RUN_OUT_MIN', 'MID_DROP_MAX', 'MID_CROWN_YIELD', 'CLIMB_PACK', 'midCrown', 'midSweep',
  'RIDGE_PASSES',
  'ELEMENTS', 'makeRng', 'hash2', 'vnoise', 'fbm', 'hills', 'inHole', 'smoothRidges', 'planTrack',
];

const source = shim + WANTED.map(grab).join('\n') + `
const NAME = ['RUN', 'CLIMB', 'SWIM', 'FLY', 'WALK', 'PUSH'];
const args = process.argv.slice(2);
const only = args[0] && !/^\\d/.test(args[0]) ? args[0] : null;
const seeds = (args.filter((a) => /^\\d/.test(a)).length ? args.filter((a) => /^\\d/.test(a)) : [11, 777]);
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
    console.log('\\n' + cat.id + '  seed ' + seed + '  ' + plan.length.toFixed(1) + ' m  ' + JSON.stringify(plan.tally));
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
`;

const tmp = path.join(HERE, '.plan-test.mjs');
fs.writeFileSync(tmp, source);
try {
  const { execFileSync } = await import('child_process');
  execFileSync(process.execPath, [tmp, ...process.argv.slice(2)], { stdio: 'inherit' });
} finally {
  fs.unlinkSync(tmp);
}
