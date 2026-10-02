// fixtures.js - what every spec boots the county with.
//
// Two keys and both of them are seeded with `addInitScript`, which runs before
// the game's first line and not after it: a save read in after boot is a save
// `load()` never saw, and the game's answer to a save it never saw is
// `shuffleOrder()`, which picks a **random** season off `Date.now()`. That is
// the one way this suite could pass while measuring nothing, so nothing here may
// be seeded late and nothing here may be hand-written.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'playwright/test';
import { GFX, GFX_KEY, SAVE_KEY } from './tier.js';

// `__dirname`, and not `import.meta.url`: a `.js` spec is compiled to CommonJS
// before it runs, so `import.meta` is a syntax error in one.
const HERE = __dirname;

/** The game's own save, captured off a running game by `capture.spec.js` and
 *  committed. `load()` wants `v: 2` and a `pool` of exactly 64 entries of
 *  `{attrs, rating}` and it checks both, so a hand-written fixture that missed
 *  one would be rejected **in silence**. */
export const SAVE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-save.json'), 'utf8'));

export { GFX, GFX_KEY, SAVE_KEY };

/** How long a boot may take, and it is short on purpose. The county boots in
 *  about two seconds under SwiftShader at 480x300 and has been measured at 3.5 s
 *  wall clock for the slowest spec's first paint, so twenty is ten times the
 *  worst good case. **A longer timeout does not make the suite more patient, it
 *  makes a failure slower to find**: a page that throws in a module body never
 *  reaches `window.__snail`, and every spec that waits for it waits the whole
 *  budget first - twenty-two tests at three minutes each is an hour of a
 *  one-line error. So the wait is short and the errors are surfaced with it. */
export const BOOT_MS = 20000;

/** Seed the keys, then go. `gfx: null` seeds the save and **leaves the settings
 *  key alone**, which is how a spec asks "does the tier the game just wrote come
 *  back?" - an init script re-runs on every navigation, so a page armed with the
 *  fixture's tier stamps that tier back over whatever was saved and the reload
 *  proves nothing. */
export async function boot(page, { gfx = GFX } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.stack) || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(
    ([save, gfxKey, saveKey, gfxVal]) => {
      localStorage.setItem(saveKey, save);
      if (gfxVal) localStorage.setItem(gfxKey, JSON.stringify(gfxVal));
    },
    [JSON.stringify(SAVE), GFX_KEY, SAVE_KEY, gfx],
  );
  await page.goto('/snail-race.html', { waitUntil: 'load' });
  // `window.__snail` existing is the game's own statement that its last line
  // ran, and it is the only completion signal here that is not a timeout with a
  // guess in it: `#boot` is removed 700 ms after it goes, so a page that reached
  // `.gone` may already have taken the element the loader would have to read.
  try {
    await page.waitForFunction(() => !!window.__snail, null, { timeout: BOOT_MS });
  } catch (e) {
    // **The module-evaluation throw, printed here rather than as a bare
    // timeout.** A missing or misspelled export is a `ReferenceError` before the
    // first frame, and the boot screen never moves off whichever line the game
    // had reached - which is "loading the meshes…" for anything that throws
    // after the loader and says nothing else at all.
    let said = '(gone)';
    try { said = await page.locator('#boot').textContent({ timeout: 2000 }); } catch {}
    throw new Error(
      `the county did not boot in ${BOOT_MS / 1000}s.\n`
      + `  #boot says: ${said}\n`
      + `  page errors:\n${errors.map((x) => '    ' + x).join('\n') || '    (none)'}\n`
      + `  ${e.message}`);
  }
  return { errors };
}

/** One pageerror fails a spec, and it is the primary gate for the whole change:
 *  **a missing or misspelled export in a module graph throws at
 *  module-evaluation time, before a single frame is drawn**, and no assertion
 *  about what was drawn would ever see it. */
export function noErrors(errors) {
  expect(errors, 'page errors').toEqual([]);
}
