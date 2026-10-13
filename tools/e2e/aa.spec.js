// aa.spec.js - the edge filter reaches the chain, and it filters.
//
// **The switch was dead twice over, and neither half could be seen from the
// frame.** The shader would not compile - a vec4 built from a texture fetch and
// a scalar is five components for four slots, and every driver answers
// 'constructor' : too many arguments - so the pass drew nothing. And the pass
// was never added when the switch moved, because `syncPasses()`'s key carried
// the other four terms of the chain and not this one: a switch that moves
// nothing else leaves the key unchanged, the guard returns early, and the
// build-and-drop lines twelve lines below never run.
//
// **A pass that costs nothing and does nothing reads as the cheapest effect on
// the board**, which is why a frame-time measurement could not find either half
// and why the gate here is the pass list and the picture rather than a clock.
// The pass list catches the key: `ShaderPass` is the edge filter and nothing
// else in the chain is one. `badProgram` catches the shader, because three
// records a program that failed to compile there. And the two grabs catch the
// pair of them together, because a filter that is in the chain and compiles
// still has to change the frame it is given.
import { test, expect } from 'playwright/test';
import { boot, noErrors } from './fixtures.js';

test('the edge filter is in the chain on its own switch, and it changes the frame', async ({ page }) => {
  const { errors } = await boot(page);
  noErrors(errors);
  // **A course walked and the camera parked**, because the race camera moves
  // and a frame difference measured across a moving camera is a measurement of
  // the camera. The cloud shade and the wind are frozen for the same reason:
  // both scroll, and a scrolling shadow is a frame that differs from itself.
  await page.evaluate(() => window.__snail.inspect('dash'));
  await page.evaluate(() => {
    const t = window.__snail.track('dash');
    const i = Math.floor(t.sm.length * 0.45);
    const a = t.sm[i].p, b = t.sm[Math.min(i + 6, t.sm.length - 1)].p;
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    window.__snail.view(a.x - dx / L * 9, a.y + 3.4, a.z - dz / L * 9,
      a.x + dx / L * 24, a.y + 0.4, a.z + dz / L * 24);
  });
  await page.evaluate(() => {
    window.__snail.setFx('fxCloud', 0);
    window.__snail.setFx('fxWind', 0);
  });
  await page.waitForTimeout(2500);
  const grab = () => page.evaluate(() => window.__snail.grab(192, 108));
  const mean = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  };
  const passes = () => page.evaluate(() => window.__snail.info().passes);
  const bad = () => page.evaluate(() => window.__snail.info().badProgram);

  // **The chain has to be standing, and the suite's own tier is the one place
  // it is not.** `boot()` seeds the bottom preset - `ssao: 1`, no composer, no
  // target - because that is the tier the repo documents as the one that must
  // not regress, and the filter is gated on the occlusion row above its bottom
  // cell. So the row is raised here rather than a preset pressed: a preset is a
  // full write of nine rows and this spec is about one switch.
  await page.evaluate(() => window.__snail.setGfx('ssao', 4));
  await page.waitForTimeout(900);
  expect((await passes()).length, 'the chain is up').toBeGreaterThan(0);

  await page.evaluate(() => window.__snail.setFx('fxAa', 0));
  await page.waitForTimeout(500);
  expect(await passes(), 'no ShaderPass with the switch off').not.toContain('ShaderPass');

  // **The control, and it is the whole of what makes the next line mean
  // anything.** Two grabs of the same setting: if the county is still, this is
  // zero, and any difference the filter then makes is the filter's.
  const c1 = await grab();
  await page.waitForTimeout(700);
  const c2 = await grab();
  const drift = mean(c1, c2);
  expect(drift, 'the parked course is still').toBeLessThan(0.5);

  await page.evaluate(() => window.__snail.setFx('fxAa', 1));
  await page.waitForTimeout(700);
  expect(await passes(), 'the filter is in the chain on its own switch').toContain('ShaderPass');
  expect(await bad(), 'the filter compiles').toEqual([]);
  const on = await grab();
  const lift = mean(c2, on);
  expect(lift, 'the filter changes the frame').toBeGreaterThan(1.0);

  // **And the drop half of the same key**, which is the half a first cut leaves
  // out: a pass that is built on its switch and never removed is a pass the
  // player cannot turn off.
  await page.evaluate(() => window.__snail.setFx('fxAa', 0));
  await page.waitForTimeout(700);
  expect(await passes(), 'the filter leaves the chain on its own switch').not.toContain('ShaderPass');
  noErrors(errors);
});
