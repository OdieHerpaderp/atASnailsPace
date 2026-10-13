// Diagnostic: measure the GI lift after removing the receiver's albedo.
import { test } from 'playwright/test';
import { boot, noErrors } from './fixtures.js';

test('gi diag 3', async ({ page }) => {
  const { errors } = await boot(page);
  noErrors(errors);
  await page.evaluate(() => window.__snail.start('dash'));
  await page.evaluate(async () => {
    const S = window.__snail;
    const out = {};
    for (const n of [1, 4, 6]) {
      await S.setGfx('ssao', n);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out['ssao' + n] = {
        passes: S.info().passes,
        badProgram: S.info().badProgram,
        mean: +((await S.grab(48, 27)).reduce((a, b) => a + b, 0) / 1296).toFixed(1),
      };
    }
    window.__diag3 = out;
  });
  console.log(JSON.stringify(await page.evaluate(() => window.__diag3), null, 2));
});
