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
  await page.waitForFunction(() => !!window.__snail, null, { timeout: 180000 });
  return { errors };
}

/** One pageerror fails a spec, and it is the primary gate for the whole change:
 *  **a missing or misspelled export in a module graph throws at
 *  module-evaluation time, before a single frame is drawn**, and no assertion
 *  about what was drawn would ever see it. */
export function noErrors(errors) {
  expect(errors, 'page errors').toEqual([]);
}
