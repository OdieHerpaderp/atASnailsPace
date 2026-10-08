/**
 * The track planner, run on its own in node.
 *
 *   node tools/plan-test.mjs                 every course, a few seeds
 *   node tools/plan-test.mjs sky 11 777      one course, these seeds
 *   node tools/plan-test.mjs sky 11 --leaps  and the gaps in detail
 *   node tools/plan-test.mjs --faces         the wardrobe, and nothing else
 *   node tools/plan-test.mjs --biomes        the biome table, and nothing else
 *   node tools/plan-test.mjs --seasons       the cups, and nothing else
 *
 * **The wardrobe check is the only one that is not about a course**, and it is here
 * rather than in a test of its own because it needs the same thing this file already
 * has: `FACE_SET`, `HAT_SET`, `faceFor()` and `hatFor()` come out of `src/core.js`
 * with no three.js and no browser, which is the same reason the planner is here.
 *
 * It answers one question, and it is the question three hand-kept lists can only
 * answer by agreeing by accident: **does every name a rival can be given exist in
 * `MESH_SETS`, and is `plain` reachable by every rival that nothing else claims?**
 * Three copies of sixteen names is three chances not to, and the failure is silent -
 * a rival wearing a name no file is behind draws as a snail with no face, which is
 * indistinguishable from a snail whose face is plain.
 *
 * **`devil` and `devil-horns` are asserted unreachable from the derivation and
 * reachable only from a duel**, because that is the whole of what `locked` means: a
 * horned snail in the Sunday Cup is a reward in the wrong place.
 *
 * The planner is imported straight out of `src/plan.js`, so what is printed here
 * is what the game would build, without a browser, a save file or a season you
 * are allowed into. It is the way to check a course or a new obstacle: how long
 * it comes out, what it asks of you in order, and how big each gap, lip, wall
 * and puddle actually is.
 *
 * **This used to read the pre-split `snail-race.js` as text**, regex for a declaration, guess
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
import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTrack } from '../src/plan.js';
import { CATS, CAT_BY_ID, TIERS, CRATE_S, CRATE_BACK, CRATE_LANE, FACE_SET, HAT_SET, faceFor, hatFor, makeRng, ATTRS, ATTR_MAX, CLUB_SNAILS, CLUB_ATTR, ratingOf, START_RATING, POOL_SIZE, POINTS, RATING_GAIN, PODIUM_FLOOR, RATING_STEP, RATING_MIN, RATING_MAX, eligibleSeasons, COND } from '../src/core.js';
import { SURFACE } from '../meshes/maps.js';
import { COUNTY } from '../meshes/palette.js';
import { BIOMES, PAL_KEYS, SET_ROLES, ROLE_KEYS, COUNTY_PROPS } from '../meshes/biomes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * The prop names, **read out of `src/materials.js` rather than written here.**
 *
 * `MESH_FILES` is inside the one module in the county that imports three, so this
 * file cannot import it - and the alternative is a second list, which is a list
 * that rots and a gate that stops gating. It is read the same way `NEEDS` is read
 * out of `src/core.js` a few lines down: one `.mjs` copy, one source of truth.
 *
 * **And the array's `//` comments are stripped before the names are taken out of
 * it**, because a comment in that list is prose about a file and the prose is full
 * of backticks and apostrophes: the first cut of this read `' five**, and they are
 * on this list'` as a prop name, and the gate then reported all five of the
 * ashlands' pieces as missing from a list they were on. A regex over source text is
 * a regex over source text.
 */
const MESH_FILES = [...readFileSync(join(ROOT, 'src/materials.js'), 'utf8')
  .match(/^const MESH_FILES = \[([\s\S]*?)\n\];/m)[1]
  .replace(/\/\/[^\n]*/g, '')
  .matchAll(/'([^']+)'/g)]
  .map((m) => m[1]);
/**
 * **The one name a biome may place that has no file**, and it is one name and it
 * is written down. `flower` is a `PLACE` slot in `src/scenery.js` whose geometry is
 * an `IcosahedronGeometry` built inside `populate()` - a flower is a coloured ball
 * ten centimetres across and a glb buys it nothing - so it is in the biome's prop
 * list and not in `MESH_FILES`. `PLACE` is unreachable from here, because that
 * module imports three, so the exemption is **stated rather than derived**; a
 * second one should be a file rather than a second name.
 */
const NO_FILE = new Set(['flower']);
/** And a file that is on the list and not in `meshes/` is a hole in the county. */
const meshThere = (f) => existsSync(join(ROOT, 'meshes', f));

/**
 * The wardrobe, checked in node.
 *
 * **It builds its own pool rather than importing `makePool()`**, and the reason is
 * that `race.js` pulls in three.js and a scene; this file has neither and is not
 * going to. The two places it would have to be kept in step with `makePool()` are
 * the `sum` line and the split inside it, and both are reproduced here verbatim
 * rather than described - a description would let this file check a pool the game
 * does not have, which is the one thing a check like this is for.
 */
async function facesReport(MAPS, lerp, payMultOf) {
  // **the names the loader is asked to find**, read out of `meshes/maps.js`
  // rather than written here: `maps.js` is the manifest and it is what says which
  // file a prop is, and a face with an empty entry in it is a face that is not
  // converted - which is exactly the state these are in.
  const known = new Set(Object.keys(MAPS));
  const faceNames = FACE_SET.map((f) => 'face-' + f.name);
  const hatNames = HAT_SET.filter((h) => !h.sentinel).map((h) => 'hat-' + h.name);
  let bad = 0;
  const say = (ok, line) => { if (!ok) bad++; console.log((ok ? '  ok   ' : '  FAIL ') + line); };

  console.log('the wardrobe\n');
  for (const n of faceNames) say(known.has(n), `${n} is in meshes/maps.js`);
  for (const n of hatNames) say(known.has(n), `${n} is in meshes/maps.js`);
  // **`none` has no file and that is the point of it.** It is the sentinel: a
  // hatless snail is a `null` mesh, not a missing one. Asserting the file is
  // `sentinel: true` is asserting that the set knows which of its members is not a
  // thing, which is the only reason the shop can list it at all.
  say(HAT_SET.some((h) => h.name === 'none' && h.sentinel && h.price === 0), 'hat none is a sentinel and not a file');

  // **the stylesheet is a fourth list of the same names, and it is the one this
  // check could not see.** `rivalRow()` renders a face as an `<i class="f-…">`,
  // so a face with a rule in `FACE_SET`, an entry in `meshes/maps.js` and a file
  // on disk but no `.f-*` rule in `snail-race.css` draws nothing at all - the
  // exact silent failure the comment beside `rivalRow` names. The three copies
  // this file already checks are `FACE_SET`/`HAT_SET`, the manifest, and the
  // files; the fourth is the glyph list, and it is read here the same way.
  // `plain` has no glyph and `none` is the sentinel, so neither is expected.
  const css = await readFile(new URL('../snail-race.css', import.meta.url), 'utf8');
  const cssFaces = new Set((css.match(/\bf-([a-z-]+)/g) || []).map((s) => s.slice(2)));
  const cssHats = new Set((css.match(/\bh-([a-z-]+)/g) || []).map((s) => s.slice(2)));
  for (const f of FACE_SET) {
    if (f.name === 'plain') continue;
    say(cssFaces.has(f.name), `face ${f.name} has a .f-${f.name} rule in snail-race.css`);
  }
  for (const h of HAT_SET) {
    if (h.sentinel) continue;
    say(cssHats.has(h.name), `hat ${h.name} has a .h-${h.name} rule in snail-race.css`);
  }
  // and nothing in the stylesheet that the sets do not declare: a stray glyph
  // is a rule for a face nobody can wear, which is a name waiting to go stale
  for (const n of cssFaces) say(FACE_SET.some((f) => f.name === n), `.f-${n} in snail-race.css is a face in FACE_SET`);
  for (const n of cssHats) say(HAT_SET.some((h) => h.name === n), `.h-${n} in snail-race.css is a hat in HAT_SET`);

  // and the pool, walked end to end
  const r = makeRng(99123);
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const sum = i < CLUB_SNAILS ? CLUB_ATTR * ATTRS.length
      : Math.min(ATTR_MAX * ATTRS.length, Math.round(lerp(6, ATTR_MAX * ATTRS.length, i / (POOL_SIZE - 1))));
    const attrs = {};
    if (i < CLUB_SNAILS) {
      for (const a of ATTRS) attrs[a.key] = CLUB_ATTR;
    } else {
      let left = sum;
      for (let k = 0; k < ATTRS.length - 1; k++) {
        const rest = ATTRS.length - 1 - k;
        const hi = Math.min(ATTR_MAX, left - rest);
        const lo = Math.min(hi, Math.max(1, left - ATTR_MAX * rest));
        const v = lo + ((r() * (hi - lo + 1)) | 0);
        attrs[ATTRS[k].key] = v;
        left -= v;
      }
      attrs[ATTRS[ATTRS.length - 1].key] = Math.min(ATTR_MAX, Math.max(1, left));
    }
    let total = 0, over = 0;
    for (const a of ATTRS) { total += attrs[a.key]; if (attrs[a.key] > ATTR_MAX) over++; }
    pool.push({
      id: i, attrs, rating: ratingOf(total), over,
      skill: 0.94 + r() * 0.13, greed: 0.15 + r() * 0.75, jitter: r() * Math.PI * 2,
    });
  }
  // **and no attribute above the ceiling anywhere**, which is the whole of what the
  // clamp in `makePool()` is for and the thing the old spread got wrong
  say(pool.every((p) => !p.over), `all ${pool.length} rivals have every attribute at or below ${ATTR_MAX}`);

  const tally = {};
  for (const p of pool) {
    const f = faceFor(p), h = hatFor(p);
    tally[f] = (tally[f] || 0) + 1;
    tally[h] = (tally[h] || 0) + 1;
    if (!FACE_SET.some((x) => x.name === f)) say(false, `rival ${p.id} was given the face '${f}', which is not in FACE_SET`);
    if (!HAT_SET.some((x) => x.name === h)) say(false, `rival ${p.id} was given the hat '${h}', which is not in HAT_SET`);
    // **the two locked names, and this is the assertion that matters**
    if (f === 'devil' || h === 'devil-horns') say(false, `rival ${p.id} was given '${f}'/'${h}', which is locked`);
  }
  console.log('  faces ' + Object.entries(tally)
    .filter(([k]) => FACE_SET.some((x) => x.name === k) || HAT_SET.some((x) => x.name === k))
    .map(([k, n]) => `${k} ${n}`).join(' · '));
  const used = new Set(pool.flatMap((p) => [faceFor(p), hatFor(p)]));
  say(FACE_SET.every((f) => f.locked || used.has(f.name) || f.price === 0),
    `every buyable face is reachable: ${FACE_SET.filter((f) => used.has(f.name)).map((f) => f.name).join(', ')}`);
  say(HAT_SET.filter((h) => used.has(h.name)).length >= 4,
    `${HAT_SET.filter((h) => used.has(h.name)).length} of ${HAT_SET.length - 1} hats reach the pool, so the set is not one hat and a gap`);

  // **the ladder, because the wardrobe's prices are in the same gold as it**
  const ratings = pool.map((p) => p.rating);
  console.log(`\n  ladder ${Math.min(...ratings)} to ${Math.max(...ratings)} · `
    + `club snails on ${ratingOf(CLUB_ATTR * ATTRS.length)} · distinct ${new Set(ratings).size} of ${pool.length}`);
  // **and the climb, walked the way a player walks it: in the best season the rating
  // opens.** Racing the Sunday Cup five times over because it is the only door you
  // have at 10 is not a strategy, it is a misunderstanding of `eligibleSeasons()` -
  // the GP's five races are the same five races at two and a half times the points,
  // and the tier you can enter is a function of the rating you got last time.
  let rt = START_RATING;
  const walk = (mult) => {
    rt = Math.min(RATING_MAX, Math.max(RATING_MIN,
      rt + Math.min(RATING_STEP, Math.max(RATING_GAIN[0], PODIUM_FLOOR[0]) * mult)));
  };
  const seasons = [];
  for (let season = 0; season < 5; season++) {
    const open = eligibleSeasons(rt);
    const best = open[open.length - 1];
    seasons.push(best.id);
    for (let i = 0; i < 5; i++) walk(payMultOf(best.id));
    console.log(`  season ${season + 1}: ${best.id} at x${payMultOf(best.id)} -> ${rt}`);
  }
  say(rt > Math.max(...ratings),
    `five clean seasons reach ${rt}, above the top of the pool at ${Math.max(...ratings)}`);
  const payout = Math.round(POINTS[0] * payMultOf('gp'));
  say(payout > POINTS[0], `a GP win is worth ${payout} against ${POINTS[0]} in the Sunday Cup`);

  console.log(bad ? `\n${bad} problem(s).` : '\nfaces: every name a rival can be given exists.');
  process.exitCode = bad ? 1 : 0;
}

/**
 * The cups, and the two claims they make.
 *
 * **A cup is one course of each trait and then the marathon**, and the second half
 * is where the shapes are written down: four courses means four traits, so four
 * rounds is the whole of one rung and the finale is the fifth race on top of it.
 * A roster that lost a trait is the quietest thing the county can do - four
 * courses get planned, four races get run, a purse is paid out of each, and the
 * card prints "tests power" on two lines with nothing saying a snail never flew.
 * It is checked at boot in `src/core.js` as well, and this is the half that
 * *prints* it, because a boot error tells you the county will not start and not
 * which of the four tiers is the one with the hole in it.
 *
 * **The second claim is the ashlands one, and it is a claim about a swap.** Every
 * cup gets an ashlands round, and it enters in place of the temperate course of
 * the trait it shares - so the traits are the same four in all four tiers, and
 * what moves round is which one wears the ash. That has one consequence worth a
 * check of its own: **every trait needs a course in every biome**, because the
 * tier that swaps the flying round in has nothing to swap if the ashlands has no
 * flying course. A trait with a course in one biome and not the other is the
 * answer to a question nobody asked, which is the shape of the whole of this
 * file.
 */
function seasonsReport() {
  let bad = 0;
  const say = (ok, msg) => {
    if (!ok) bad++;
    console.log(`  ${ok ? '  ok  ' : ' FAIL '} ${msg}`);
    return ok;
  };
  const traits = ATTRS.filter((a) => a.key !== 'stamina').map((a) => a.key);
  const band = (s) => `${s.lo}–${s.hi === Infinity ? 'open' : s.hi} at x${s.payMult}`;
  const ofTrait = (t) => CATS.filter((c) => c.trait === t);
  const biomes = [...new Set(CATS.map((c) => c.biome))].sort();

  for (const s of TIERS) {
    console.log(`\n${s.id}  —  ${s.name}, ${band(s)}`);
    for (const id of s.races) {
      const c = CAT_BY_ID[id];
      console.log(`    ${String(c.trait || '—').padEnd(9)} ${c.name.padEnd(20)} ${c.biome}`);
    }
    const fin = CAT_BY_ID[s.finale];
    console.log(`    ${String(fin && fin.trait ? fin.trait : 'every trait').padEnd(9)} ${fin ? fin.name.padEnd(20) : '—'.padEnd(20)} FINALE`);

    // 1. one of each trait, and the four rounds are four distinct traits
    const tally = new Map();
    for (const id of s.races) {
      const t = CAT_BY_ID[id].trait;
      if (t) tally.set(t, (tally.get(t) || 0) + 1);
    }
    const missing = traits.filter((t) => !tally.has(t));
    const twice = [...tally].filter(([, n]) => n > 1).map(([t]) => t);
    const loose = s.races.filter((id) => !CAT_BY_ID[id].trait);
    say(!missing.length && !twice.length && !loose.length,
      `one course of each of ${traits.join(', ')}`
      + [missing.length ? ` — no ${missing.join(', no ')}` : '',
        twice.length ? ` — ${twice.join(', ')} twice` : '',
        loose.length ? ` — ${loose.join(', ')} tests nothing` : ''].join(''));

    // 2. the finale: there is one, it is not on the card twice, and it is the
    //    course that tests nothing rather than one of the four
    say(!!fin && !s.races.includes(s.finale) && !fin.trait,
      fin ? `${fin.name} closes it and tests every trait`
        : 'a finale that exists, is not one of the four, and tests every trait');

    // 3. **one ashlands round, and it is a swap** - the trait it shares with the
    //    course it replaced is the only claim here, and it is the one that makes
    //    the other three tiers keep their traits
    const ash = s.races.filter((id) => CAT_BY_ID[id].biome !== 'temperate');
    say(ash.length === 1, `one ashlands round${ash.length === 1 ? ` — ${CAT_BY_ID[ash[0]].name}` : ` — ${ash.length}`}`);

    // 4. **every trait has a course in every biome**, which is what a swap needs to
    //    be possible in all four tiers and not only the ones it has been used in
    for (const t of traits) {
      const holes = biomes.filter((b) => !ofTrait(t).some((c) => c.biome === b));
      say(!holes.length, `${t}: ${ofTrait(t).map((c) => `${c.name} (${c.biome})`).join(', ')}`
        + (holes.length ? ` — nothing in ${holes.join(', ')}` : ''));
    }
  }

  console.log(bad ? `\n${bad} problem(s).`
    : `\nseasons: ${TIERS.length} cups, one course of each of ${traits.length} traits and a finale in every one.`);
  process.exitCode = bad ? 1 : 0;
}

/**
 * The biome table, and the five questions a table can be wrong in that a browser
 * will not answer.
 *
 * **Every one of these is a gate and none of them is a crash**, which is the whole
 * of why they are here and not in the game: a role naming a `SURFACE` key nothing
 * has heard of means `detailOf()` answers `null` and `triplanarSets()` filters it
 * out and keeps its other sets, so the surface comes up with *two* of its three
 * maps and a shader that compiled perfectly; a `pal` that is fifteen long leaves
 * the sixteenth holding whatever it had on load, which is `temperate`'s; a prop
 * with no glb behind it places nothing and says nothing because `scatter()` filters
 * a null geometry out before it draws. All three are the project's own failure
 * mode - **a default is an answer, and an empty one is the answer to a question
 * nobody asked** - and all three are quiet.
 *
 * The sixth thing it prints is the pair `standingReport()` hands out beside its
 * `pieces` count, **counted here at prop granularity against the union of what any
 * biome names** rather than at slot granularity, because `PLACE`'s slots live in
 * `src/scenery.js` and this file cannot import a module with three.js in it. So
 * the number here and the number on screen are the same fact at two resolutions,
 * and the one that catches "a biome has quietly stopped declining anything" is
 * this one.
 */
function biomeReport() {
  let bad = 0;
  /** And it says every check, not only the failures: a biome report that printed
   *  only its problems would be unreadable for the thing it is most used for,
   *  which is **confirming that a role's tile and a palette key are what you
   *  meant before you went and looked at them in the game.** */
  const say = (ok, msg) => {
    if (!ok) bad++;
    console.log(`  ${ok ? '  ok  ' : ' FAIL '} ${msg}`);
    return ok;
  };

  // 1. every course names a biome the table has, and every biome is used
  const unused = Object.keys(BIOMES).filter((b) => !CATS.some((c) => c.biome === b));
  say(!unused.length, `every biome is on a course${unused.length ? ` — ${unused.join(', ')} is on nothing` : ''}`);
  for (const c of CATS) {
    if (!BIOMES[c.biome]) { say(false, `${c.id} is in a biome called ${c.biome}`); continue; }
  }

  for (const [id, b] of Object.entries(BIOMES)) {
    console.log(`\n${id}  —  ${b.label}`);

    // 2. four roles, each naming a SURFACE key, and **the same seven set entries
    // in the same order as every other biome** - the weight a vertex gives a set
    // is the set's letter, so a biome that left one out would change what the rest
    // multiply and three would find a different program under one material name.
    const roles = Object.keys(b.surface);
    say(ROLE_KEYS.every((r) => roles.includes(r)) && roles.length === ROLE_KEYS.length,
      `four roles: ${roles.join(', ')}`);
    for (const r of ROLE_KEYS) {
      const role = b.surface[r];
      if (!role) continue;
      say(SURFACE[role.key], `${r} → ${role.key}${SURFACE[role.key] ? '' : ' — SURFACE has never heard of it'}`);
      /**
       * **The tile is the reciprocal, and saying otherwise is how the setts came
       * out 364 mm across.** `setsFor()`'s `scale` is the shader's `dS` and the
      * fetch is `texture2D(map, uv * dS)`, so `1 / scale` is the tile's length in
      * metres and `scale` is its *frequency* - which is what the county's own
      // rule says about it (*the frequency and the tile move together*). Printing
      * `scale` as a tile in metres is a number that is wrong by the reciprocal
      * and wrong by more the further from one it is, so **the tile is printed**:
      // the course's turf reads `5 m` at `0.20`, the road's track `1.18 m` at
      // `0.85`, and the bower's setts whatever they are asked for.
      */
      const tile = 1 / role.scale;
      say(tile > 0.125 && tile < 8, `${r} tile ${tile.toFixed(2)} m (scale ${role.scale})`);
      say(Number.isFinite(role[role.rampGain === undefined ? 'gain' : 'gain']), `${r} gain ${role.gain}`);
    }
    for (const which of Object.keys(SET_ROLES)) {
      say(SET_ROLES[which].length >= 2 && SET_ROLES[which].length <= 4,
        `${which} carries ${SET_ROLES[which].length} sets: ${SET_ROLES[which].map((r) => r[0]).join(', ')}`);
    }

    // 3. **sixteen palette names**, all of them in the jar. Fifteen is the quiet
    // one: the sixteenth would keep the value it had on load, which is
    // `temperate`'s, and that is the quiet answer with a plausible value in it.
    const palKeys = Object.keys(b.pal);
    say(palKeys.length === PAL_KEYS.length && PAL_KEYS.every((k) => palKeys.includes(k)),
      `${palKeys.length} palette keys${palKeys.length === PAL_KEYS.length ? '' : ` — ${PAL_KEYS.filter((k) => !palKeys.includes(k)).join(', ')} missing`}`);
    for (const k of PAL_KEYS) {
      const name = b.pal[k];
      if (name === undefined) { say(false, `${k} is not named`); continue; }
      say(COUNTY[name], `${k} → ${name}${COUNTY[name] ? '' : ' — no colour by that name in the jar'}`);
    }
    // and `noGreens`: a single green in a palette group is a course with a meadow
    // in it, and it is a flag rather than a comment because a comment cannot be
    // asked a question.
    if (b.noGreens) {
      const green = PAL_KEYS.filter((k) => {
        const t = COUNTY[b.pal[k]];
        return t && t[1] > t[0] && t[1] > t[2];
      });
      say(!green.length, `no greens among its sixteen${green.length ? ` — ${green.join(', ')} is green` : ''}`);
    }

    // 4. a prop list, every name loaded **and every file there**
    say(b.props.length > 0, `${b.props.length} props`);
    for (const prop of b.props) {
      if (NO_FILE.has(prop)) { say(true, `${prop} (built in place, no file)`); continue; }
      say(MESH_FILES.includes(prop), `${prop}${MESH_FILES.includes(prop) ? '' : ' — not in MESH_FILES'}`);
      if (MESH_FILES.includes(prop)) say(meshThere(prop + '.glb'), `${prop}.glb${meshThere(prop + '.glb') ? '' : ' — on the list and not in meshes/'}`);
    }

    // 5. the far country is two jar names and not two hexes, and so is the haze
    for (const k of ['near', 'far']) {
      say(COUNTY[b.far[k]], `far ${k} → ${b.far[k]}${COUNTY[b.far[k]] ? '' : ' — no colour by that name in the jar'}`);
    }
    say(b.fog === null || COUNTY[b.fog], `fog → ${b.fog || 'none'}${b.fog && !COUNTY[b.fog] ? ' — no colour by that name in the jar' : ''}`);

    // 6. named / declined against the union of what any biome names
    const declined = COUNTY_PROPS.filter((p) => !b.props.includes(p));
    say(declined.length > 0 || Object.keys(BIOMES).length === 1,
      `places ${b.props.length} of ${COUNTY_PROPS.length}, declines ${declined.length}`
      + (declined.length ? ` (${declined.join(', ')})` : ''));
  }

  console.log(bad ? `\n${bad} problem(s).` : `\nbiomes: ${Object.keys(BIOMES).length} biomes, `
    + `${COUNTY_PROPS.length} props, every role, key, colour and file resolved.`);
  process.exitCode = bad ? 1 : 0;
}

/**
 * Every condition's `attr` has to be a key of `ATTRS`, and its `base` has to be a
 * speed. **`COND[cond].attr` is read straight into `r.sn.eff[attr]` at
 * `race.js:1600` and there is nothing between them**: a condition whose `attr` is
 * not a stat - a typo, a rename, a stat cut from the save - gives `eff[undefined]`
 * = `undefined`, so `target` is `NaN` on the first frame of that section and every
 * snail on the course stops dead in the same place with nothing in the console.
 * Six conditions never had that bug because six conditions have always been
 * right, and the seventh is here.
 *
 * **This is three lines and it is the gate for the failure the whole county is
 * written against**, so it belongs beside the other walks of a list rather than in
 * a test of its own.
 */
function condReport() {
  let bad = 0;
  const say = (ok, line) => { if (!ok) bad++; console.log((ok ? '  ok   ' : '  FAIL ') + line); };
  for (const [i, c] of COND.entries()) {
    if (!ATTRS.some((a) => a.key === c.attr)) say(false, `COND[${i}] ${c.key}: attr '${c.attr}' is not a stat`);
    else say(true, `COND[${i}] ${c.key}: ${c.name}, tests ${c.attr} at ${c.base.toFixed(2)} m/s`);
    if (!(c.base > 0)) say(false, `COND[${i}] ${c.key}: base ${c.base} is not a speed`);
  }
  console.log(bad ? `\n${bad} problem(s).` : `\nCOND: ${COND.length} conditions, every attr a stat and every base a speed.`);
  process.exitCode = bad ? 1 : 0;
}

/** **Read off `COND` and not written out**, which is how the seventh condition came
 * to print as `undefined×26` in this file's own course walk. A hand-kept list of
 * six names beside a table of seven is one more copy to fall out of step, and
 * this one falls out of step silently. */
const NAME = COND.map((c) => c.key.toUpperCase());
const args = process.argv.slice(2);
if (args.includes('--seasons')) {
  seasonsReport();
} else if (args.includes('--cond')) {
  condReport();
} else if (args.includes('--biomes')) {
  biomeReport();
} else if (args.includes('--faces')) {
  // **the manifest and the planner's own helpers are imported here and not at the
  // top of the file**, because a `--faces` run must not pay for reading
  // `races.json` and planning five courses it is about to throw away - and because
  // `maps.js` has no three.js in it either, so this stays a node-only check.
  const { MAPS } = await import('../meshes/maps.js');
  const { lerp, TIER_BY_ID } = await import('../src/core.js');
  await facesReport(MAPS, lerp, (id) => TIER_BY_ID[id].payMult);
} else {
  const detail = args.includes('--leaps');
  const only = args[0] && !/^\d/.test(args[0]) ? args[0] : null;
  const seeds = (args.filter((a) => /^\d/.test(a)).length ? args.filter((a) => /^\d/.test(a)) : [11, 777]);
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
}
