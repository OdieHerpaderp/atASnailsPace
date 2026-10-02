// playwright.config.js
//
// The suite drives the game in a browser, so this file answers two questions
// that are the machine's and not the game's: which browser, and which tier.
//
// **SwiftShader, because there is no GPU here.** three r160 will not start
// without WebGL2, and headless chromium gets WebGL2 from the software
// rasteriser - correct, and slow. 480x300 is a county of 144 thousand pixels,
// which is a size a software rasteriser can hold sixty times a second, and the
// specs are about numbers rather than about pictures.
//
// **One worker, deliberately.** Two specs in parallel means two counties
// rasterised on one software rasteriser, which turns a slow spec into a flaky
// one, and a gate that is flaky is a gate nobody trusts.
//
// The tier itself is seeded from `localStorage` in `e2e/fixtures.js` and not
// set here, because the tier is a *fact about the build* rather than about the
// browser: it has to be in `localStorage` before the game's first line runs if
// it is to be in force before the first frame is drawn.
import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './e2e',
  // **The capture is not part of the suite.** `capture.spec.js` writes
  // `baseline.json`, and a baseline regenerated from the code it is meant to be
  // checking agrees with whatever is broken - so it only runs when a name says
  // so, and that name is `CAPTURE`.
  testIgnore: process.env.CAPTURE ? [] : '**/capture.spec.js',
  // **Ninety seconds, and not the five minutes it was.** A course is planned,
  // built, scattered and then raced at 4 kHz of simulated time, and the slowest
  // spec in the suite - five courses, five whole races, and the chain built and
  // torn down twice - measures 6.4 s on a software rasteriser. Ninety is
  // fourteen times that, and the point of a ceiling nobody expects to reach is
  // that reaching it is a report and not an afternoon.
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8713',
    browserName: 'chromium',
    viewport: { width: 480, height: 300 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        // **WebGL2 on a machine with no GPU.** The three flags are the whole of
        // it: ANGLE as the GL implementation, SwiftShader as what ANGLE draws
        // with, and the unsafe switch because SwiftShader is exactly the case
        // that switch exists to allow. Without the third of them chromium logs a
        // warning and hands back a context that fails on the first draw call.
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  webServer: {
    command: 'python3 serve.py',
    url: 'http://127.0.0.1:8713/snail-race.html',
    cwd: '.',
    reuseExistingServer: true,
    stdout: 'ignore',
  },
});
