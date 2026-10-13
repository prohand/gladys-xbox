// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// A scene action is an OPERATION a scene author places in a scene, with
// parameters and a result. Each one is declared in the manifest `scene_actions`
// field and handled here, keyed by that same `key`; index.js registers every
// entry with `gladys.onSceneAction(key, ...)`.
//
// Scene TRIGGERS are the other direction ("a game started"): they are fired by
// the service when it observes the change, see src/xbox/service.js.
//
// The rules that matter:
//   - `fields` arrive RESOLVED: scene variables substituted, defaults applied,
//     validated by the core; a `"source": "devices"` field is the chosen
//     device external_id;
//   - a console that cannot do it is an OUTPUT (`false`), not a failure: a
//     scene action is never a condition, the scene author gates on the output;
//   - never fire a scene event as a consequence of a received action: a scene
//     bound to that event would loop through the integration.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { BUTTONS } from './xbox/cloud.js';

const logger = createLogger({ name: 'scenes' });

// Same bounds as the manifest field: the action times out at 120 s.
export const WAKE_WAIT_MAX_SECONDS = 100;

function findConsole(service, externalId) {
  const console = service.findConsole(externalId);
  if (!console) {
    // A deleted device, or a scene copied from another Gladys.
    throw new Error(`Unknown console: ${externalId}`);
  }
  return console;
}

async function attempt(what, run) {
  try {
    await run();
    return true;
  } catch (err) {
    logger.warn(`${what} failed: ${err.message}`);
    return false;
  }
}

export const SCENE_ACTIONS = {
  // Turn the console on and wait until it answers: the next actions of the
  // scene (launch a game...) need it awake.
  async wake_console(service, { fields }) {
    const console = findConsole(service, fields.device);
    const waitSeconds = Math.min(
      WAKE_WAIT_MAX_SECONDS,
      Math.max(0, Number(fields.wait_seconds ?? 60)),
    );
    logger.info(`Scene action wake_console <- ${console.name} (${waitSeconds} s)`);
    let awake = false;
    await attempt('Waking the console', async () => {
      awake = await service.wake(console, waitSeconds);
    });
    return { awake };
  },

  async launch_game(service, { fields }) {
    const console = findConsole(service, fields.device);
    const productId = String(fields.product_id ?? '').trim();
    logger.info(`Scene action launch_game <- ${console.name}: ${productId}`);
    const launched = await attempt('Launching the game', () => service.launch(console, productId));
    return { launched };
  },

  async press_button(service, { fields }) {
    const console = findConsole(service, fields.device);
    if (!BUTTONS.includes(fields.button)) {
      throw new Error(`Unknown controller button: ${fields.button}`);
    }
    logger.info(`Scene action press_button <- ${console.name}: ${fields.button}`);
    const pressed = await attempt('Pressing the button', () =>
      service.pressButton(console, fields.button),
    );
    return { pressed };
  },
};
