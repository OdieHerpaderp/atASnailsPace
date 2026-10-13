// title.spec.js - the front door.
//
// **Five tests, and every one of them is a thing that can be quietly wrong rather
// than loudly broken.** The title is a mode, a screen and three buttons, and the
// failure mode of each of those is a plausible answer:
//
//   - a fifth `mode` the frame loop forgot draws the county's empty scene, which
//     is a black screen and no error;
//   - a fifth `mode` the *hour* forgot is lit at hour 0, which is a warm low sun
//     and a picture nobody would call wrong;
//   - `Continue` present with no save behind it, or `New game` that erases on the
//     first press, which are both buttons that look right.
//
// So the second test below is the one worth the file: it asks
// `world.renderScene()` through `drawn()`, which is the call both the direct
// path and the chain make. Nothing else in the suite would notice a
// `renderScene()` that had not learned about `title`: the mode is a string, and a
// string agrees with itself.
import { test, expect } from 'playwright/test';
import { boot, noErrors, SAVE } from './fixtures.js';
import { SAVE_KEY } from './tier.js';

/** The two keys this build used to answer to, under which every save and every
 *  set of graphics settings in a returning browser still sits. They are named
 *  here rather than read out of the page so that the assertion below has
 *  something to be false against. */
const DEAD_SAVE = 'snail-grand-prix-v1';
const DEAD_GFX = 'snail-grand-prix-gfx-v1';

/**
 * The fixture save with a **name on it**, and this is the whole reason.
 *
 * `tools/e2e/fixture-save.json` is a capture of a *fresh* game - season 1, gold
 * 50, rating 10, a snail called Wilma - so it and the state `wipeSave()` writes
 * are the same page twice and no field of them is an observable of whether the
 * wipe ran. Only one thing differs and it has to be put there deliberately: the
 * name. `wipeSave()` hand-lists its own reset and `state.name = 'Wilma'` is on it,
 * so a wiped game says Wilma and an unwiped one says whatever this said - and
 * that is one number, read off `state`, rather than a comparison of two saves
 * field by field.
 */
const NAMED = { ...SAVE, name: 'Pellet' };

test('the title is where the county comes up, and it says whose season is waiting', async ({ page }) => {
  const { errors } = await boot(page);
  expect(await page.evaluate(() => window.__snail.mode), 'the mode on the first frame').toBe('title');
  // **The scene predicate, asked on the path this spec runs on.** The suite is
  // pinned at the bottom tier, which runs the game's own single
  // `renderer.render()` and has no composer at all - so this is the direct path,
  // and it is the one `background().passScene` cannot speak for. `drawn` asks
  // `world.renderScene()` itself, which is the call both paths make.
  expect(await page.evaluate(() => window.__snail.drawn()),
    'the scene the direct path draws on the title').toBe('stage');
  await expect(page.locator('#title'), 'the title screen').toHaveClass(/on/);
  // **and the lobby is not on behind it.** `#stable` carries no `on` in the
  // markup, which is the half of this that no script has to get right: a page
  // whose title is up over a visible lobby has two front doors, and the lobby's
  // own `Delete save` is one of them.
  await expect(page.locator('#stable'), 'the lobby').not.toHaveClass(/on/);
  await expect(page.locator('#titleContinue'), 'Continue with a save behind it').toBeVisible();
  // **The summary is one line off `state`, and `state` is the loaded save.** It
  // is here rather than on the lobby's field card because the question a player
  // is asking at a front door is "is this the snail I left", and the season
  // number is the part of that answer that is not the player's name on screen.
  const save = await page.locator('#titleSave').textContent();
  expect(save, 'the summary names the season it would come back to').toContain(`season ${SAVE.season}`);
  noErrors(errors);
});

test('the title draws the stable and not an empty county scene', async ({ page }) => {
  const { errors } = await boot(page);
  // **The occlusion ladder goes up one step, and that is the whole reason the
  // second assertion exists at all.** `background().passScene` reads
  // `gtaoPass.scene` - the scene the **G-buffer** is being built from - and at
  // the bottom rung there is no GTAO pass, so it answers `null` on a frame that
  // is drawing the stable perfectly well. The switch is a promise and awaiting it
  // is how the rest of the suite waits for the addons, which are fetched on
  // demand from the CDN and are a frame or a second after the page is up.
  await page.evaluate(() => window.__snail.setGfx('ssao', 2));
  // **This is the assertion the mode needs and nothing else can make.** The
  // title is a shot of the same place the lobby is, so `renderScene()` has to
  // answer `stage` for it, and it used to answer on `mode === 'stable' ||
  // mode === 'stroll'` in three files. Miss one and the frame is the county's
  // scene: no stable, no lawn, no error, and `mode` still reads `'title'`. A
  // string is not a picture and nothing else in the suite would see it.
  const bg = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Object.assign(window.__snail.background(), { drawn: window.__snail.drawn() });
  });
  expect(bg.passScene, 'the scene the G-buffer is built from').toBe('stage');
  expect(bg.drawn, 'and the scene the frame loop picked').toBe('stage');
  expect(bg.mode, 'and the mode it dispatched on').toBe('title');
  expect(bg.stageSky, 'the stable\'s own dome is up').toBe(true);
  // **And the camera is the wide shot's, off `ORBIT.title` rather than off a
  // number written here** - twenty-six metres out and eleven up, which is what
  // says the row of the table the lobby does not use is the row being read. A
  // title over the lobby's four-metre orbit is a perfectly good title and a
  // completely different one.
  const cam = await page.evaluate(() => window.__snail.cam);
  const flat = Math.hypot(cam.pos[0], cam.pos[2]);
  expect(flat, 'the camera is out in the county and not on the plinth')
    .toBeGreaterThan(20);
  expect(cam.pos[1], 'and up above the tree line').toBeGreaterThan(8);
  // **And the shadow box is the wide one**, which is the number with no other
  // observable anywhere in the county. A tree outside the key's ortho frustum
  // does not cast a soft shadow, it casts *no* shadow, and a tree with no shadow
  // is a sticker: the lobby's sixty-metre box is correct from four metres and
  // leaves the grove, the palms and the giant mushrooms standing on the lawn.
const box = await page.evaluate(() => window.__snail.stageShadow());
  expect(box.right, 'the box reaches out past the fifty-eight-metre disc').toBeGreaterThan(55);
  expect(box.far, 'and deep enough for the far side of it').toBeGreaterThan(100);
  // **`mapSize` is on the hook and is deliberately not asserted here.** It is the
  // shadows row's number and not this screen's - at the bottom rung it is 512, at
  // the top it is 2048 - and pinning it here would be pinning a settings row in
  // a spec about a mode. What it decides is how coarse the wide box's shadows
  // are, and `smoke.spec.js` is where the row is the subject.
  //
  // The hour is not asserted here either, and cannot be. A title lit at hour 0
  // rather than 0.55 is a low warm evening instead of the mid-morning the lobby
  // stands at, which is the quietest failure this change could have - and there
  // is nothing on the page that reports the stage env's light, so there is no
  // assertion to write. What there is instead is that `onStableScreen()` is one
  // function the hour, the sun's glow and the far country all ask, rather than
  // three files each holding their own copy of a pair of strings.
  noErrors(errors);
});

test('Continue is the way in, and it lands in the lobby', async ({ page }) => {
  const { errors } = await boot(page);
  await page.locator('#titleContinue').click();
  // **A cut and not a swoop**, the same as every other screen change here, and
  // the two are asserted together because they are one function: `closeTitle()`
  // writes the mode and the two classes in three statements.
  expect(await page.evaluate(() => window.__snail.mode), 'the mode after Continue').toBe('stable');
  await expect(page.locator('#stable'), 'the lobby is up').toHaveClass(/on/);
  await expect(page.locator('#title'), 'and the title is not').not.toHaveClass(/on/);
  // **And the narrow box is back.** `closeTitle()` asks `stage.js` for the box
  // *after* the mode has moved, because a box asked while `mode` still says
  // `title` is eighteen texels a metre spent on a shot four metres wide - soft
  // shadows on the one screen where the snail fills the frame is a visible
  // regression on the hero shot the player sees every time they press Continue.
  const box = await page.evaluate(() => window.__snail.stageShadow());
  expect(box.right, 'the lobby keeps its sixty-metre box').toBe(30);
  expect(box.far, 'and its fifty-metre depth').toBe(50);
  noErrors(errors);
});

test('with no save there is no Continue, and New game goes straight in', async ({ page }) => {
  const { errors } = await boot(page, { save: null });
  // **Hidden and not merely inert.** A Continue that says the season and then
  // throws is the failure; a Continue that says nothing and comes back to the
  // same fresh game is nearly as bad, because it is a button that lies about
  // there being something to continue.
  await expect(page.locator('#titleContinue'), 'Continue with nothing behind it').toBeHidden();
  await expect(page.locator('#titleNew'), 'New game is always there').toBeVisible();
  // **The line under the buttons says the other thing** - and it is a different
  // sentence rather than an empty one, because a blank line under a hidden
  // Continue is a layout accident and this is the game saying it has nothing.
  expect(await page.locator('#titleSave').textContent(), 'and the line under it says so')
    .toContain('No season saved');
  await page.locator('#titleNew').click();
  expect(await page.evaluate(() => window.__snail.mode), 'New game with no save is one press').toBe('stable');
  await expect(page.locator('#stable'), 'the lobby').toHaveClass(/on/);
  // **And the save it wrote is a v3 save under the key this build answers to**,
  // which is the other half of the rename: a fresh game written under the old
  // key would be a game the next build throws away.
  const written = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SAVE_KEY);
  expect(written.v, 'the new game is a v3 save').toBe(3);
  expect(written.name, 'and it is a fresh snail').toBe('Wilma');
  noErrors(errors);
});

test('New game arms on the first press and erases on the second, and the old keys are gone', async ({ page }) => {
  // **The dead keys are seeded by hand**, because nothing in the game's own
  // fixture writes them and the line under test is `removeItem`. A browser that
  // has played the county keeps both forever otherwise.
  await page.addInitScript(([a, b]) => {
    localStorage.setItem(a, '{"v":3}');
    localStorage.setItem(b, '{"preset":1}');
  }, [DEAD_SAVE, DEAD_GFX]);
  const { errors } = await boot(page, { save: NAMED });

  await page.locator('#titleNew').click();
  // **One press arms and nothing else.** The button says so in words, because a
  // button that only turns red is a button whose meaning is a colour - and the
  // lobby's own `Delete save` has been saying it out loud for a season.
  await expect(page.locator('#titleNew'), 'the armed button says what the second press does')
    .toHaveText(/Erase and start again/);
  const armed = await page.evaluate((k) => {
    const raw = JSON.parse(localStorage.getItem(k));
    return { name: raw.name, on: window.__snail.mode };
  }, SAVE_KEY);
  expect(armed.name, 'the first press did not erase the save').toBe(NAMED.name);
  expect(armed.on, 'and did not leave the title either').toBe('title');

  await page.locator('#titleNew').click();
  expect(await page.evaluate(() => window.__snail.mode), 'the second press goes in').toBe('stable');
  await expect(page.locator('#titleNew'), 'and the button is a button again')
    .toHaveText(/^New game$/);
  // **Read off the key and not off `state`**, because this is the assertion the
  // key move makes and it is the durable half: a wipe that reset the memory and
  // never wrote would leave `state` correct and the next reload empty.
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SAVE_KEY);
  expect(after.name, 'the save on disk is the fresh one').toBe('Wilma');
  expect(after.season, 'and it is a season one').toBe(1);

  // **And the two keys this build no longer answers to have been taken out**, so
  // a returning player is not carrying them for the rest of time.
  const dead = await page.evaluate(([a, b]) => [a, b].map((k) => localStorage.getItem(k)),
    [DEAD_SAVE, DEAD_GFX]);
  expect(dead, 'the save and settings keys the game used to answer to').toEqual([null, null]);
  noErrors(errors);
});