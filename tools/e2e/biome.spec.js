// biome.spec.js - the second biome, and the six ways it can be a wrong picture.
//
// A biome is **five** roles, sixteen palette names and a prop list, and **every one of
// the failures below is a wrong picture rather than a broken one.** Nothing here
// throws: a role naming a `SURFACE` key nothing has heard of means
// `detailOf()` answers null and `triplanarSets()` filters it out and keeps its
// other sets, so the surface comes up with two of its three maps and a shader that
// compiled perfectly; a `pal` of fifteen leaves the sixteenth holding whatever it
// had on load; a prop with no glb behind it places nothing and says nothing
// because `scatter()` filters a null geometry out before it draws. **A default is
// an answer, and an empty one is the answer to a question nobody asked** - which
// is the whole of why this file exists and the whole of why `plan-test.mjs
// --biomes` is its node-side half.
//
// The first test is the load-bearing one. It walks ten courses and asks each of
// them four questions, and the four are the four things a biome is:
//
//   1. **the program.** `mat.course.customProgramCacheKey()` has to carry the
//      biome's name. Leave it out and `needsUpdate` recompiles, three finds
//      `triplanarSets3Uv` in its cache, **hands back the meadow's program**, and
//      the ashlands ground comes up with the meadow's grain at the meadow's gain -
//      which reads as a picture decision rather than as a bug.
//   2. **the palette.** The sixteen, as the numbers the surfaces actually baked.
//   3. **the arrangement.** What is standing, and how much of it was declined.
//   4. **the hour.** `raceHourKey()`, because the duel is raced at the finale hour
//      and the same literal reading that put the duel's field size in the data put
//      its hour there too.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from 'playwright/test';
import { boot, noErrors } from './fixtures.js';
import { hex } from '../../meshes/palette.js';
import { PAL_KEYS } from '../../meshes/biomes.js';

const RACES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../races.json'), 'utf8'));
const SEASONS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../seasons.json'), 'utf8'));
/** The four traits a course can name. `stamina` is not one of them and cannot be:
 *  it is the bar the marathon drains, not a course. Four courses means four traits. */
const TRAITS = ['running', 'power', 'swimming', 'flying'];

/**
 * **The courses are read off the disk here and not out of the page.** `fetch` from
 * `page.evaluate` needs a base URL, and this spec asks its first question *before*
 * it boots anything - so the first version asked it on an `about:blank` and read
 * `Failed to parse URL from /races.json`, which says nothing whatever about what
 * went wrong. `tier.js` reads `races.json` off the disk for the same reason and for
 * the same sake: a second list of ten course names in a spec is a list that rots.
 */
const courses = () => RACES.map((c) => ({
  id: c.id, biome: c.biome, duel: !!c.duel,
  // **and the hour off the duel entry**, so the assertion below reads one thing
  // rather than reaching into a boolean. It was `c.duel.hour` on a `duel` that
  // was a `!!c.duel`, which is `undefined`, and the suite reported a duel with no
  // hour on a course that names one.
  duelHour: c.duel && c.duel.hour,
}));

/**
 * **And two frames, because `openInspector()` builds the course inside one.**
 *
 * It defers on purpose - "building a course is a moment's work; say so rather than
 * freeze" - so a spec that asks what biome is standing straight after calling
 * `inspect()` is asking about the *previous* course, and the answer is a plausible
 * one: `temperate` for an ashlands course, with no error anywhere. **That is the
 * quiet failure this file is about, walked into by its own first draft.**
 */
const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

test('ten courses, and every one of them stands the biome it names', async ({ page }) => {
  const list = courses();
  expect(list.length, 'the county has ten courses').toBe(10);
  // and the two biomes are the two the table has, and the ashlands is half of them
  const kinds = [...new Set(list.map((c) => c.biome))].sort();
  expect(kinds, 'the two biomes').toEqual(['ashlands', 'temperate']);
  expect(list.filter((c) => c.biome === 'ashlands').length,
    'five courses in the ashlands and five in the hedgerows').toBe(5);

  /**
   * **One page and ten courses on it**, and that is not tidiness: the first draft
   * called `boot()` inside the loop and ten page loads took longer than the suite's
   * ninety-second test timeout, so the test failed on a `page.goto` that never
   * arrived and said nothing whatever about a biome. `openInspector()` closes the
   * last course itself, so walking all ten in a row is exactly what the inspector
   * does when a player opens the next card - and it is also what exercises the
   * path that matters, **a biome change over a standing course**.
   */
  const { errors } = await boot(page);
  const seen = { temperate: [], ashlands: [] };
  for (const c of list) {
    await page.evaluate((id) => window.__snail.inspect(id), c.id);
    await page.evaluate(twoFrames);
    const b = await page.evaluate(() => window.__snail.biome());
    const standing = await page.evaluate(() => window.__snail.standing());
    const bow = await page.evaluate(() => window.__snail.bower());
    /** **And the set names the material is really running**, which is the one
     *  thing about the bower that cannot be seen in a picture. `triplanarSets()`
     *  drops a set whose map file is missing, so a road that declares three and
     *  finds two comes up as a two-set material, its cache key answers
     *  `triplanarSets2Uv` - which is another material's key - and the road draws
     *  with the flank's program, no setts, and **nothing anywhere red.** The
     *  warning the loader prints is the first half; this is the assertion. */
    const roadSets = await page.evaluate(() => window.__snail.setsOf('mat.road'));
    const info = await page.evaluate(() => window.__snail.info());

    // 1. the standing biome is the one the course names
    expect(b.name, `${c.id}: the biome standing`).toBe(c.biome);
    // **and the program carries it.** This is the assertion that cannot be made
    // from a screenshot: three hands back a cached program under a material name
    // when the key does not say otherwise, and the picture that comes out is
    // wrong rather than broken - the ashlands ground wearing the meadow's grain at
    // the meadow's gain, and nothing in the console.
    expect(b.sets.course, `${c.id}: the ground's cache key`).toBe(`triplanarSets3:${c.biome}`);
    expect(b.sets.road, `${c.id}: the ribbon's cache key`).toBe(`triplanarSets3Uv:${c.biome}`);
    expect(b.sets.ledge, `${c.id}: the flank's cache key`).toBe(`triplanarSets3Uv:${c.biome}`);

    // **And the road carries all three of its sets, and its third is the setts.**
    // This is the gate for the whole road as a whole: the bower's set goes on Z so
    // the two the road already had keep their letters, and a road without it is a
    // road with no setts on it under a canopy that says there are.
    //
    // **And the first two are the biome's own maps and not the names the roles
    // have** - `ashTrack` and `basalt` on a dead valley - so the assertion is about
    // the count and about the *third* one, which is the only set every biome has to
    // be handed the same name. Writing `['track', 'cliff', 'bowerSetts']` would
    // have passed on four courses and failed on the fifth, for no reason a reader
    // of the failure could have named.
    expect(roadSets && roadSets.length, `${c.id}: the ribbon carries three sets`).toBe(3);
    expect(roadSets[2], `${c.id}: and its third is the bower's setts`).toBe('bowerSetts');

    /** **And the height set is not null**, per course and per set-wearing
     *  material. A surface that declared a `-h` and got none is the
     *  loader's quiet-failure path: `detailOf()` answers `null` and
     *  `triplanarSets()` drops the set's height and keeps its normal, and
     *  the road marches on the normal alone - which is the same picture
     *  as a road that never had a `-h` at all, and the only thing that
     *  says which it is is the material's own register. `setHeightsOf()`
     *  reads that register and not the biome's table, for the same reason
     *  `setsOf` does: a gate that asks the table is a gate that passes
     *  on the quiet-failure path, and the gate is the material's own
     *  register. The assertion is one per material the course wears -
     *  `course`, `road` and `ledge` - and it is that none of the sets
     *  that should have a `-h` came back without one. */
    for (const mat of ['mat.course', 'mat.road', 'mat.ledge']) {
      const hs = await page.evaluate((w) => window.__snail.setHeightsOf(w), mat);
      const names = await page.evaluate((w) => window.__snail.setsOf(w), mat);
      expect(hs && names, `${c.id}: ${mat} carries a height register`).not.toBeNull();
      expect(hs.length, `${c.id}: ${mat} height count matches set count`).toBe(names.length);
      // The ground and the flank wear the biome's own turf, cliff and shore
      // roles, and every one of them declares a `-h`; the ribbon wears
      // track, cliff and bowerSetts, which also all declare one. So the
      // expected answer is every set present, and a `false` in the list
      // is a set that declared a `-h` and got none - the quiet failure
      // this gate is for.
      const missing = hs.map((ok, i) => (ok ? null : names[i])).filter((n) => n !== null);
      expect(missing, `${c.id}: ${mat} every set that declared a -h got one`).toEqual([]);
    }

    // 2. five roles and sixteen keys, every one of them resolved
    expect(b.roles.length, `${c.id}: five roles`).toBe(5);
    expect(Object.keys(b.pal).length, `${c.id}: sixteen palette names`).toBe(16);
    // **And every one of the sixteen resolved to the colour it named** - not merely
    // to *a* colour. `PAL` carries twenty keys and sixteen of them are the biome's;
    // the other four belong to the farmsteads and the stable's own stonework, so a
    // count taken over `PAL` is a count over the wrong thing, and a name that
    // resolved to the wrong jar entry would pass it. The expected value comes from
    // `hex()` on the node side and the actual from `PAL` on the page, so this is
    // one jar read two ways rather than one number written twice.
    const wrong = Object.keys(b.pal)
      .filter((k) => b.palNow[k] !== hex(b.pal[k]).toString(16).padStart(6, '0'));
    expect(wrong, `${c.id}: every palette key is the colour its biome named`).toEqual([]);

    // **and no greens**, which is the one hard rule on the ash block and the reason
    // it is a flag on the biome rather than a sentence in a comment: a single green
    // in a palette group is a course with a meadow in it, and the first one
    // anybody adds is going to be deliberate.
    if (c.biome === 'ashlands') {
      const green = Object.entries(b.palNow).filter(([k]) => PAL_KEYS.includes(k)).filter(([, h]) => {
        const r = parseInt(h.slice(0, 2), 16) / 255;
        const g = parseInt(h.slice(2, 4), 16) / 255;
        const bl = parseInt(h.slice(4, 6), 16) / 255;
        return g > r && g > bl;
      }).map(([k]) => k);
      expect(green, `${c.id}: nothing in the ashlands is green`).toEqual([]);
    }

    // 3. the arrangement, and **the decline**. Every biome declines something, or
    //    it has quietly stopped being a biome and is the county again - and that is
    //    an absence, which is the failure this project is written against.
    expect(standing.biome, `${c.id}: the register knows which biome filled it`).toBe(c.biome);
    expect(standing.declined, `${c.id}: declined something`).toBeGreaterThan(0);
    expect(standing.pieces, `${c.id}: and placed something`).toBeGreaterThan(0);
    // **and the props are the ones this biome names and not the ones it does not.**
    // `ash-tree` is the tell in both directions: absent from a temperate course and
    // standing all over an ashlands one.
    expect(!!standing.by['ash-tree'], `${c.id}: a dead tree is a thing the hedgerows do not have`)
      .toBe(c.biome === 'ashlands');
    expect(!!standing.by.conifer, `${c.id}: a conifer is a thing the ashlands does not have`)
      .toBe(c.biome === 'temperate');

    // 4. the hour a course is raced in. **It is the finale hour for the duel *and*
    //    for the marathon**, and the second of those is not a coincidence: the
    //    marathon is all four tiers' `finale`, so `raceHourKeyOf()` has two roads
    //    to `'finale'` and the change is that the duel's is the *first* one it
    //    looks at. The first draft of this assertion said every non-duel is `day`,
    //    and the marathon is not.
    expect(await page.evaluate((cid) => window.__snail.raceHourKey(cid), c.id),
      `${c.id}: its own hour`)
      .toBe(c.duel ? c.duelHour : (c.id === 'marathon' ? 'finale' : 'day'));

    /* ---- 5. **the green bower**, and it is a section and not a register entry. --
     *
     * Two courses deal one and the other eight do not, **and the eight are the half
     * worth having**: a bower standing in an ashlands course is a green tunnel in a
     * dead valley, and the assertion that says so is the one that says the *biome*
     * is doing the work rather than the course table. So the expectation is read
     * off the biome's own prop list rather than written as a list of two ids -
     * otherwise a third course gaining a bower turns this into a second list to
     * keep, which is the failure every table in this county is written against.
     */
    const wantsBower = c.biome === 'temperate' && (c.id === 'dash' || c.id === 'marathon');
    if (wantsBower) {
      expect(bow, `${c.id}: a bower stands`).not.toBeNull();
      expect(bow.ranges, `${c.id}: at least one section of it`).toBeGreaterThanOrEqual(1);
      // **the ribs are a shape and not a count**, but a bower of four hoops is a
      // shed: the section is twenty-six metres and the pitch is a little over two
      expect(bow.ribs, `${c.id}: enough iron to be a tunnel`).toBeGreaterThanOrEqual(10);
      expect(bow.mass, `${c.id}: and leaves on it`).toBeGreaterThan(0);
      expect(bow.spray, `${c.id}: and a fringe`).toBeGreaterThan(0);
      /** **And `litter > 0` is the assertion that keeps §6 honest.** `litter` is the
       *  arc length of `BOWER` lane, which is the length of the leaves on the road,
       *  which is the length of the stretch `COND[6]` slows a snail down. A bower
       *  with no litter on it is a tunnel over a road that gives no reason to be
       *  slow, and **the picture and the simulation stop being the same fact** -
       *  which is the whole failure this feature is written against. */
      expect(bow.litter, `${c.id}: leaves on the road, and the road is slow because of them`)
        .toBeGreaterThan(0);
      expect(bow.s.length, `${c.id}: two numbers per section`).toBe(bow.ranges * 2);
      /* **And a drift of dead leaves on the verges**, which is the floor of the
       * tunnel and the one thing in the picture that says the growth is old. It is
       * a file of its own and not a third mesh of the foliage **because it must
       * not take the wind** - green hangs in `mat.foliage` and bends, and a dead
       * leaf on the ground that sways is a leaf in the air. A zero here means the
       * litter model is missing from `MESH_FILES` or from `meshes/`, and neither
       * throws: `standBower()` guards on the geometry and simply places nothing. */
      expect(bow.drifts, `${c.id}: leaf drift along both verges`).toBeGreaterThan(0);
    } else {
      expect(bow, `${c.id}: no bower, because the biome declined the props or the plan dealt none`).toBeNull();
    }

    // and nothing broke on the way
    expect(info.glError, `${c.id}: glError`).toBe(0);
    expect(info.badProgram, `${c.id}: programs that did not compile`).toEqual([]);
    seen[c.biome].push(standing.declined);
  }
  noErrors(errors);
  // **and the two biomes decline different things**, which is the last quiet
  // answer: a table whose `props` lists are both the whole list would place
  // everything everywhere and every `declined` would be zero. Both are caught above;
  // this is the sentence that says the two are not the same list.
  expect(new Set(seen.temperate).size, 'the five hedgerow courses are not all the same course').toBeGreaterThan(0);
  expect(seen.temperate.every((n) => n > 0), 'and all five decline something').toBe(true);
  expect(seen.ashlands.every((n) => n > 0), 'and so do all five of the ashlands').toBe(true);
  expect(seen.temperate[0] === seen.ashlands[0] && seen.temperate[1] === seen.ashlands[1],
    'and no two courses are standing the same arrangement').toBe(false);
});

test('the stable comes up green after an ashlands course has been walked and it rebuilt', async ({ page }) => {
  const { errors } = await boot(page);
  // **The order is the test.** A stable is built on fresh materials with `PAL` read
  // at build time, and **vertex colours are baked** - so a stable already standing is
  // untouched by a later `useBiome()` elsewhere, and `restage()` is what rebuilds
  // it. Which is the whole of why `buildStable()` has to say `useBiome('temperate')`
  // for itself: `restage()` is called on a density change, so the two are not "a
  // race and then never again", and the failure is a **grey lobby** with nothing
  // wrong anywhere.
  const before = await page.evaluate(() => window.__snail.biome());
  expect(before.name, 'the stable is temperate at boot').toBe('temperate');

  await page.evaluate(() => window.__snail.inspect('ashClimb'));
  await page.evaluate(twoFrames);
  const away = await page.evaluate(() => window.__snail.biome());
  expect(away.name, 'walking an ashlands course stands the ashlands').toBe('ashlands');

  // and back: a rebuild is what a density change does, and it is the only thing
  // that rebuilds the lawn, so it is what this asks
  await page.evaluate(() => { window.__snail.setGfx('props', 1); window.__snail.setGfx('props', 3); });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__snail.biome());
  expect(after.name, 'and a rebuilt stable is temperate again').toBe('temperate');
  expect(after.palNow.grassA, 'the lawn\'s green is the county\'s green again')
    .toBe(before.palNow.grassA);
  expect(await page.evaluate(() => window.__snail.info()).then((i) => i.glError), 'glError').toBe(0);
  noErrors(errors);
});

test('the far country takes the standing biome, and the stable keeps its own', async ({ page }) => {
  const { errors } = await boot(page);
  const hills = () => page.evaluate(() => window.__snail.biome().hills);
  const temper = await hills();
  await page.evaluate(() => window.__snail.inspect('ashPool'));
  await page.evaluate(twoFrames);
  const ash = await page.evaluate(() => window.__snail.biome());
  // **Two jar names and not two hexes written into the hour routine**, and this is
  // the assertion that they moved: `mat.hillNear` and `mat.hillFar` are one pair
  // shared by two backdrops, so a biome changes them for both and the *screen* is
  // what decides which pair it should be wearing.
  expect(ash.far, 'the ashlands names its own two').toEqual({ near: 'ashHillNear', far: 'ashHillFar' });
  expect(ash.hills.near, 'and the near ridge is not the meadow\'s').not.toBe(temper.near);
  expect(ash.hills.far, 'and the far one is not either').not.toBe(temper.far);
  // and the haze is a multiply on the *race* env's fog and not a colour
  expect(ash.fog, 'a jar name').toBe('ashHaze');
  expect(ash.fogNow, 'and the race fog is wearing it').not.toBe(temper.near);
  noErrors(errors);
});

test('every cup is one course of each trait and a finale, and the ash round is a swap', () => {
  const cat = (id) => RACES.find((c) => c.id === id);
  /** The four, as the roster hands them over - order included, because the card
   *  draws the roster in this order and two lines saying the same thing is what
   *  this file exists to catch. */
  const ashRound = new Map();

  for (const s of SEASONS) {
    const traits = s.races.map((id) => cat(id).trait);
    expect(traits, `${s.id}: one course of each of ${TRAITS.join(', ')}`).toEqual(TRAITS);
    // **and the finale, which is the fifth race and not a fifth round.** It has to
    // exist, be off the card proper, and name no trait: the card prints "every
    // trait" for a course with none, and a finale that printed "tests flying"
    // would be the one race in five that is about something.
    const fin = cat(s.finale);
    expect(fin, `${s.id}: a finale that exists in races.json`).toBeTruthy();
    expect(s.races, `${s.id}: and is not one of the four`).not.toContain(s.finale);
    expect(fin.trait, `${s.id}: and tests every trait`).toBeFalsy();
    expect(s.races.length, `${s.id}: four rounds`).toBe(4);

    // **the ashlands round, and it is the course of the trait it replaced** - so
    // the four tiers keep the same four traits and what moves round is which one
    // wears the ash
    const ash = s.races.map((id) => cat(id)).filter((c) => c.biome !== 'temperate');
    expect(ash.length, `${s.id}: one ashlands round`).toBe(1);
    ashRound.set(s.id, ash[0].id);
    expect(s.races.filter((id) => cat(id).trait === ash[0].trait),
      `${s.id}: ${ash[0].name} is the only ${ash[0].trait} course on the card`).toEqual([ash[0].id]);
  }

  // **and all four of them get raced.** A tier that swapped the flying round in
  // needs the ashlands to have a flying course, and the way that stops being true
  // is two tiers naming the same one - which leaves a hand-built course that only
  // the inspector has ever stood in. One course per trait, and one trait per tier.
  expect([...ashRound.values()].sort(), 'the four cups race four different ashlands courses')
    .toEqual(RACES.filter((c) => c.biome === 'ashlands' && !c.duel).map((c) => c.id).sort());
  expect(ashRound.size, 'and no two tiers swap the same trait in').toBe(TRAITS.length);
});

test('the duel reads six numbers off its course rather than out of the source', async ({ page }) => {
  const { errors } = await boot(page);
  const entry = RACES.find((c) => c.duel);
  expect(entry.id, 'the duel is a course in races.json').toBe('adversary');
  expect(entry.biome, 'and it is fought in the ashlands').toBe('ashlands');

  await page.evaluate(() => window.__snail.challenge());
  const got = await page.evaluate(() => {
    const S = window.__snail;
    const r = S.race;
    return {
      catId: r.catId,
      racers: r.racers.length,
      cd: r.cd,
      entry: r.duel,
      hour: S.raceHourKey(r.catId),
    };
  });
  expect(got.catId, 'the duel is on its own course').toBe(entry.id);
  expect(got.racers, 'two of them').toBe(entry.duel.field);
  // **The countdown is the entry read back, and not the clock.** `race.cd` is
  // already counting down by the time a spec can ask for it, so an equality on it
  // is an equality on frame timing - and the first draft of this line was, which
  // is how it failed. The data is what has the answer in it.
  expect(got.entry, 'and the whole of the duel is the entry, verbatim').toEqual(entry.duel);
  expect(got.cd, 'with the countdown it asked for still counting down')
    .toBeGreaterThan(entry.duel.countdown - 1);
  expect(got.cd, 'and no further').toBeLessThanOrEqual(entry.duel.countdown);
  expect(got.hour, 'at the hour the course names').toBe(entry.duel.hour);
  // **and the crate count is the field's, off the same entry.** It used to be
  // `race.duel ? 2 : FIELD`, which was a **second copy** of the duel's size written
  // beside the number it was copying - and because `race.duel` was set in
  // `startRace()` and nowhere else, not in the `race` literal and not cleared by
  // `wipeSave()`, an **inspector opened after a duel read the stale flag and built a
  // two-crate apron on an eight-snail road.** Reading it off `cat` is right for both
  // callers and there is one answer left to be wrong.
  //
  // Counted off the scene rather than off the flag, because the flag is the thing
  // that was wrong. A crate is a `Group` per box, in the course group, and there is
  // one per slot per apron.
  const boxes = await page.evaluate(() => window.__snail.race.racers
    .filter((r) => r.crateMesh).length);
  expect(boxes, 'two crates on the apron, and the entry is where they came from')
    .toBe(entry.duel.field);
  noErrors(errors);
});