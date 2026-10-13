// -----------------------------------------------------------------------------
// Wiring of the SDK handlers to the Xbox service.
//
// Kept apart from index.js so the tests can run the whole integration against
// the fake Gladys of the SDK, with a fake network (fetch, UDP) injected.
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';
import { createPoller } from './devices/index.js';
import { createXboxAuth } from './xbox/auth.js';
import { createXboxCloud } from './xbox/cloud.js';
import { createLocalChannel, createUdpTransport } from './xbox/local.js';
import { createXboxService } from './xbox/service.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS, refreshWidgets } from './widgets.js';

// Buttons of the Configuration screen, keyed like the manifest `actions`.
export const MANIFEST_ACTIONS = {
  test_connection: (service) => service.testConnection(),
};

/**
 * Register every handler on `gladys` (before connect()).
 * @param {object} gladys a GladysIntegration (or the fake one of the SDK)
 * @param {{ fetch?: typeof fetch, udp?: object, now?: () => number, wait?: (ms: number) => Promise<void> }} deps
 */
export function createApp(gladys, deps = {}) {
  const { fetch: fetchImpl = globalThis.fetch, udp = createUdpTransport(), now, wait } = deps;
  const auth = createXboxAuth({ fetch: fetchImpl, now });
  const cloud = createXboxCloud({ auth, fetch: fetchImpl });
  const local = createLocalChannel({ udp, wait });
  const service = createXboxService({ gladys, local, auth, cloud, now, wait });
  const pollConsole = createPoller({ now });

  // Power, game or transport changed: open dashboards re-pull the widget.
  service.onChange(() => refreshWidgets(gladys));

  async function discoverAndPublish() {
    await service.discover();
    await gladys.publishDiscoveredDevices(service.buildDevices());
  }

  function consoleOf(device) {
    const console = service.findConsole(device.external_id);
    if (!console) {
      // Throw: the SDK sends a success:false acknowledgement to Gladys.
      throw new Error(`Unknown console: ${device.external_id}`);
    }
    return console;
  }

  // --- Discovery: Gladys asks for the list of devices ------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> looking for consoles');
    await discoverAndPublish();
  });

  // --- Command: the user acts on a feature -----------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    await service.setValue(consoleOf(device), feature.external_id, value);
    // Read the console again at the next poll instead of waiting for the
    // refresh interval: the command changed it.
    pollConsole.forget(device.external_id);
  });

  // --- Polling: Gladys asks to refresh a console -----------------------------
  gladys.onPoll(async (device) => {
    const read = await pollConsole(device, service.config, () =>
      service.refresh(consoleOf(device)),
    );
    if (!read) {
      logger.debug(`onPoll skipped (not due) for ${device.external_id}`);
    }
  });

  // A console created, updated or deleted in Gladys: keep the list in sync.
  gladys.onDeviceCreated(async (device) => service.restoreFromDevices([device]));

  // --- Microsoft account: the "Connect" button of the oauth2 field -----------
  gladys.onOAuthAuthorizeUrl(async (_key, redirectUri) => service.authorizeUrl(redirectUri));
  gladys.onOAuthCallback(async (_key, params) => {
    await service.linkAccount(params);
    // The account brings its consoles: publish them in the Discovery tab.
    await discoverAndPublish();
    refreshWidgets(gladys);
  });

  // --- Manifest actions: buttons in the Configuration screen -----------------
  // The resolved message is displayed under the button (the ack is awaited
  // under the action's `timeout_seconds`).
  for (const [actionKey, handler] of Object.entries(MANIFEST_ACTIONS)) {
    gladys.onAction(actionKey, (fields) => handler(service, fields));
  }

  // --- Scene actions ---------------------------------------------------------
  // Scene TRIGGERS need no handler: the service fires them when it sees a game
  // start or stop (publishSceneEvent).
  for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(actionKey, (fields) => handler(service, { fields }));
  }

  // --- Dashboard widgets -----------------------------------------------------
  for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(widgetKey, (request) => widget.get(service, request));
    if (typeof widget.action === 'function') {
      gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
        widget.action(service, { actionKey, params, settings }),
      );
    }
  }

  // --- Configuration updated by the user -------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    service.setConfig(newConfig);
    await discoverAndPublish();
    await service.reportConnectionStatus();
    refreshWidgets(gladys);
  });

  // --- Connection lifecycle --------------------------------------------------
  // The SDK itself logs the WebSocket lifecycle under the `gladys-sdk` name;
  // this only runs the integration's own (re)initialization.
  gladys.on('connected', async () => {
    try {
      // 1) The config filled in by the user, and the consoles already created
      //    (their params carry the last known local address).
      service.setConfig(await gladys.getConfig());
      service.restoreFromDevices(gladys.devices);

      // 2) Look for consoles and (re)publish them.
      await discoverAndPublish();

      // 3) The badges of the consoles already read; open dashboards re-sync,
      //    the nudges sent while the socket was down were dropped.
      const transports = service.transportEntries();
      if (transports.length > 0) {
        await gladys.publishTransports(transports);
      }
      refreshWidgets(gladys);

      // 4) Application-level status, shown in the Configuration screen.
      await service.reportConnectionStatus();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Protokollen der Integration nach.',
          es: 'La inicialización ha fallado; consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  return {
    service,
    stop() {
      // Nothing long-lived to stop: every channel call is a one-shot request.
    },
  };
}
