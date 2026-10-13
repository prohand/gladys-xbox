// -----------------------------------------------------------------------------
// The Xbox service: the consoles, and which channel reaches each of them.
//
// Two channels, one device per console (keyed on its Live ID):
//   - LOCAL (SmartGlass, UDP 5050): discovery, "is it on?", power on. Free, no
//     account, but it cannot turn the console off nor press a key;
//   - CLOUD (Xbox Live, the user's Microsoft account): everything, as long as
//     the console allows remote features.
//
// The "Prefer the local connection" toggle (GLADYS_PREFER_LOCAL) picks which
// channel is asked first for the console state and for the power on; the
// other one is the fallback. The commands only the cloud can carry always go
// through it. The badge of each device says which channel served it last.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from '../config.js';
import { REFRESH_TOKEN_KEY, XboxAuthError } from './auth.js';
import { COMMANDS, buttonCommand, launchCommand } from './cloud.js';
import {
  BUTTON_FEATURES,
  FEATURES,
  NO_TITLE,
  buildConsoleDevice,
  consoleFromDevice,
  consoleIds,
  featureKey,
  liveIdFromExternalId,
} from '../devices/console.js';

const logger = createLogger({ name: 'xbox' });

// Scene trigger keys, as declared in the manifest `scene_triggers` field.
// Keys are forever: scenes store them.
export const SCENE_TRIGGERS = {
  TITLE_STARTED: 'title_started',
  TITLE_STOPPED: 'title_stopped',
};

// The presence is per account, not per console: one read serves every console
// polled in the same round.
const PRESENCE_CACHE_MS = 20 * 1000;

// A console the cloud says is on but that stays silent on its local address
// probably got a new address (DHCP): look for it again, at most this often.
const REDISCOVERY_INTERVAL_MS = 10 * 60 * 1000;

// How often `wake` checks whether the console woke up.
const WAKE_CHECK_INTERVAL_MS = 2000;

// Shown under the transport badge.
const MESSAGES = {
  NO_LOCAL_ADDRESS: {
    en: 'No local address: the LAN discovery did not find this console, the cloud serves it.',
    fr: "Pas d'adresse locale : la recherche sur le réseau n'a pas trouvé cette console, le cloud la sert.",
    de: 'Keine lokale Adresse: Die Netzwerksuche hat diese Konsole nicht gefunden, die Cloud übernimmt sie.',
    es: 'Sin dirección local: la búsqueda en la red no ha encontrado esta consola; la nube se encarga de ella.',
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The cloud channel is required and missing: tell the user how to get it. */
export class CloudRequiredError extends Error {
  constructor(what) {
    super(
      `${what} needs the cloud channel: fill in the Azure application and click "Connect" in the integration configuration.`,
    );
    this.name = 'CloudRequiredError';
  }
}

/**
 * @param {{
 *   gladys: object,
 *   local: ReturnType<import('./local.js').createLocalChannel>,
 *   auth: ReturnType<import('./auth.js').createXboxAuth>,
 *   cloud: ReturnType<import('./cloud.js').createXboxCloud>,
 *   now?: () => number,
 *   wait?: (ms: number) => Promise<void>,
 * }} deps
 */
export function createXboxService({ gladys, local, auth, cloud, now = Date.now, wait = sleep }) {
  let config = normalizeConfig();
  // liveId -> { liveId, name, consoleType, address, power, title, titleSince, transport }
  const consoles = new Map();
  let presenceCache = null;
  let lastRediscovery = 0;
  let onChange = () => {};

  auth.onRefreshToken(async (refreshToken) => {
    // Persist the rotated refresh token, or the next restart signs in with a
    // dead one. setConfig only touches the keys it is given.
    await gladys.setConfig({ [REFRESH_TOKEN_KEY]: refreshToken });
  });

  function upsert(found) {
    const known = consoles.get(found.liveId);
    if (known) {
      if (found.name) known.name = found.name;
      if (found.consoleType && found.consoleType !== 'XboxOne')
        known.consoleType = found.consoleType;
      if (found.address) known.address = found.address;
      return known;
    }
    const console = {
      liveId: found.liveId,
      name: found.name || 'Xbox',
      consoleType: found.consoleType || 'Xbox',
      address: found.address || null,
      power: null,
      // undefined = never observed: the first observation fires no event.
      title: undefined,
      titleSince: null,
      transport: null,
    };
    consoles.set(found.liveId, console);
    return console;
  }

  async function presence() {
    if (presenceCache && now() - presenceCache.at < PRESENCE_CACHE_MS) {
      return presenceCache.value;
    }
    const value = await cloud.presence();
    presenceCache = { at: now(), value };
    return value;
  }

  async function cloudCommand(console, command, what) {
    if (!auth.isLinked) {
      throw new CloudRequiredError(what);
    }
    await cloud.sendCommand(console.liveId, command);
  }

  async function publishTitleChange(console, title) {
    const previous = console.title;
    console.title = title;
    if (previous === undefined) {
      console.titleSince = title ? now() : null;
      return;
    }
    if (previous?.id === title?.id) {
      return;
    }
    const device = consoleIds(gladys, console.liveId).device;
    // A scene event per TRANSITION, never per poll (300 events/min per integration).
    if (previous) {
      const playedMinutes = console.titleSince
        ? Math.max(0, Math.round((now() - console.titleSince) / 60000))
        : 0;
      await gladys.publishSceneEvent(SCENE_TRIGGERS.TITLE_STOPPED, {
        device,
        title_name: previous.name,
        title_id: previous.id,
        played_minutes: playedMinutes,
      });
    }
    console.titleSince = title ? now() : null;
    if (title) {
      await gladys.publishSceneEvent(SCENE_TRIGGERS.TITLE_STARTED, {
        device,
        title_name: title.name,
        title_id: title.id,
      });
    }
  }

  function rediscoverSoon() {
    if (now() - lastRediscovery < REDISCOVERY_INTERVAL_MS) return;
    lastRediscovery = now();
    service
      .discover()
      .then(() => gladys.publishDiscoveredDevices(service.buildDevices()))
      .catch((err) => logger.warn(`Rediscovery failed: ${err.message}`));
  }

  const service = {
    gladys,

    get config() {
      return config;
    },

    get cloudLinked() {
      return auth.isLinked;
    },

    get gamertag() {
      return auth.identity?.gamertag ?? null;
    },

    get consoles() {
      return [...consoles.values()];
    },

    setConfig(newConfig) {
      config = normalizeConfig(newConfig);
      auth.setConfig(config);
      presenceCache = null;
    },

    /** Step 1 of the Connect button: the Microsoft sign-in URL. */
    authorizeUrl(redirectUri) {
      // The user registers this address in their Azure application: say it.
      logger.info(`Redirect URI to register in Azure: ${redirectUri}`);
      return auth.authorizeUrl(redirectUri);
    },

    /** Step 2 of the Connect button: tokens, Xbox Live sign-in, status. */
    async linkAccount({ code, state, redirectUri }) {
      await auth.handleCallback({ code, state, redirectUri });
      presenceCache = null;
      await gladys.setConnectionStatus(true);
    },

    /** Called when what a widget shows changed (power, game, transport). */
    onChange(callback) {
      onChange = callback;
    },

    /** Consoles the user already created: their params carry the last known address. */
    restoreFromDevices(devices = []) {
      for (const device of devices) {
        const console = consoleFromDevice(gladys, device);
        if (console) upsert(console);
      }
    },

    findConsole(externalId) {
      const liveId = liveIdFromExternalId(gladys, externalId);
      return liveId ? (consoles.get(liveId) ?? null) : null;
    },

    /**
     * Look for consoles on the LAN and in the Microsoft account.
     * @returns {Promise<{ local: object[], cloud: object[] | null, cloudError: Error | null }>}
     */
    async discover() {
      const found = await local.discover(gladys, config.addresses);
      for (const console of found) upsert(console);

      let inAccount = null;
      let cloudError = null;
      if (auth.isLinked) {
        try {
          inAccount = await cloud.listConsoles();
          for (const console of inAccount) upsert(console);
        } catch (err) {
          cloudError = err;
          logger.warn(`Listing the consoles of the account failed: ${err.message}`);
        }
      }
      logger.info(
        `Discovery: ${found.length} console(s) on the LAN, ${inAccount ? inAccount.length : 'no'} in the account`,
      );
      return { local: found, cloud: inAccount, cloudError };
    },

    buildDevices() {
      return [...consoles.values()].map((console) => buildConsoleDevice(gladys, console));
    },

    /**
     * Read one console and publish what changed: power, game, transport badge,
     * scene events.
     */
    async refresh(console) {
      const preferLocal = config.GLADYS_PREFER_LOCAL;
      let power = null;
      let via = null;
      let localSilent = false;

      const tryLocal = async () => {
        if (!console.address) return false;
        const answer = await local.ping(console.address);
        if (!answer) {
          localSilent = true;
          return false;
        }
        power = 'on';
        via = DEVICE_TRANSPORTS.LOCAL;
        return true;
      };
      const tryCloud = async () => {
        // No account check here: an id the account does not know fails the call.
        if (!auth.isLinked) return false;
        try {
          ({ power } = await cloud.consoleStatus(console.liveId));
          via = DEVICE_TRANSPORTS.CLOUD;
          return true;
        } catch (err) {
          logger.warn(`Cloud status of ${console.name} failed: ${err.message}`);
          return false;
        }
      };

      if (preferLocal) {
        if (!(await tryLocal())) await tryCloud();
      } else if (!(await tryCloud())) {
        await tryLocal();
      }

      if (!via && localSilent) {
        // The console does not answer and nothing else can tell: it is off
        // (or asleep in energy-saving mode).
        power = 'off';
        via = DEVICE_TRANSPORTS.LOCAL;
      }
      if (via === DEVICE_TRANSPORTS.CLOUD && power === 'on' && console.address && localSilent) {
        rediscoverSoon();
      }

      let transport;
      if (!via) {
        transport = { transport: DEVICE_TRANSPORTS.UNREACHABLE };
      } else if (via === DEVICE_TRANSPORTS.CLOUD && preferLocal && !console.address) {
        transport = { transport: via, degraded: true, message: MESSAGES.NO_LOCAL_ADDRESS };
      } else {
        transport = { transport: via };
      }

      let title = null;
      if (power === 'on' && auth.isLinked) {
        try {
          title = (await presence()).title;
        } catch (err) {
          logger.debug(`Presence read failed: ${err.message}`);
          title = console.title ?? null;
        }
      }

      const changed =
        power !== console.power ||
        title?.id !== console.title?.id ||
        JSON.stringify(transport) !== JSON.stringify(console.transport);
      console.power = power ?? console.power;
      console.transport = transport;

      const ids = consoleIds(gladys, console.liveId);
      const states = [];
      if (power) {
        states.push({
          device_feature_external_id: ids.feature(FEATURES.POWER),
          state: power === 'on' ? 1 : 0,
        });
        states.push({
          device_feature_external_id: ids.feature(FEATURES.TITLE),
          text: title?.name ?? NO_TITLE,
        });
      }
      if (states.length > 0) {
        // Only the changes, plus a heartbeat so a stable value stays dated.
        await gladys.publishChangedStates(states, { heartbeat: 30 * 60 * 1000 });
      }
      await gladys.publishTransports([{ external_id: ids.device, ...transport }]);
      if (power) {
        await publishTitleChange(console, title);
      }
      if (changed) onChange(console);
      return { power, title, transport };
    },

    /** Power on: local packet or cloud WakeUp, by preference, the other as fallback. */
    async powerOn(console) {
      const viaLocal = async () => {
        if (!console.address) return false;
        await local.powerOn(console.address, console.liveId);
        return true;
      };
      const viaCloud = async () => {
        if (!auth.isLinked) return false;
        await cloud.sendCommand(console.liveId, COMMANDS.WAKE_UP);
        return true;
      };
      const [first, second] = config.GLADYS_PREFER_LOCAL
        ? [viaLocal, viaCloud]
        : [viaCloud, viaLocal];
      try {
        if (await first()) return;
      } catch (err) {
        logger.warn(`Power on of ${console.name} failed, trying the other channel: ${err.message}`);
      }
      if (await second()) return;
      throw new Error(
        `${console.name} has no local address and no cloud channel: search the consoles again, or link a Microsoft account.`,
      );
    },

    async powerOff(console) {
      // Turning off needs an encrypted SmartGlass session: cloud only.
      await cloudCommand(console, COMMANDS.TURN_OFF, 'Turning a console off');
    },

    /** Handle a command from Gladys on one feature. */
    async setValue(console, featureExternalId, value) {
      const key = featureKey(featureExternalId);
      if (key === FEATURES.POWER) {
        if (value === 1) await service.powerOn(console);
        else await service.powerOff(console);
        // Optimistic: the next poll publishes what the console really did.
        await gladys.publishState(featureExternalId, value === 1 ? 1 : 0);
        return;
      }
      if (key === FEATURES.VOLUME_MUTE) {
        await cloudCommand(console, value === 1 ? COMMANDS.MUTE : COMMANDS.UNMUTE, 'Muting');
        await gladys.publishState(featureExternalId, value === 1 ? 1 : 0);
        return;
      }
      const button = BUTTON_FEATURES[key];
      if (!button) {
        throw new Error(`Unknown feature: ${featureExternalId}`);
      }
      await cloudCommand(console, button.command, `"${button.name}"`);
    },

    /**
     * Wake a console and wait until it answers.
     * @returns {Promise<boolean>} true when it is on within `waitSeconds`
     */
    async wake(console, waitSeconds) {
      await service.powerOn(console);
      const deadline = now() + waitSeconds * 1000;
      do {
        const { power } = await service.refresh(console);
        if (power === 'on') return true;
        if (now() >= deadline) break;
        await wait(WAKE_CHECK_INTERVAL_MS);
      } while (now() < deadline);
      return false;
    },

    async pressButton(console, button) {
      await cloudCommand(console, buttonCommand(button), 'A controller button');
    },

    async launch(console, productId) {
      await cloudCommand(console, launchCommand(productId), 'Launching a game');
    },

    async goHome(console) {
      await cloudCommand(console, COMMANDS.GO_HOME, 'Going home');
    },

    /** Media play/pause toggle, from the playback state the console reports. */
    async playPause(console) {
      if (!auth.isLinked) {
        throw new CloudRequiredError('Play / pause');
      }
      const { playbackState } = await cloud.consoleStatus(console.liveId);
      await cloud.sendCommand(
        console.liveId,
        playbackState === 'Playing' ? COMMANDS.PAUSE : COMMANDS.PLAY,
      );
    },

    /**
     * Application-level status of the Configuration screen: the cloud link
     * when one is configured; a local-only setup has nothing to report.
     */
    async reportConnectionStatus() {
      if (!auth.hasClient) {
        await gladys.setConnectionStatus(true);
        return;
      }
      if (!auth.isLinked) {
        await gladys.setConnectionStatus(false, {
          en: 'Microsoft account not linked: click Connect.',
          fr: 'Compte Microsoft non relié : cliquez sur Connecter.',
          de: 'Microsoft-Konto nicht verknüpft: Klicke auf Verbinden.',
          es: 'Cuenta Microsoft no vinculada: pulse Conectar.',
        });
        return;
      }
      try {
        await auth.authorizationHeader();
        await gladys.setConnectionStatus(true);
      } catch (err) {
        logger.error(`Xbox Live sign-in failed: ${err.message}`);
        await gladys.setConnectionStatus(
          false,
          err instanceof XboxAuthError
            ? {
                en: 'The Microsoft account link expired: click Connect again.',
                fr: 'Le lien avec le compte Microsoft a expiré : cliquez à nouveau sur Connecter.',
                de: 'Die Verknüpfung mit dem Microsoft-Konto ist abgelaufen: Klicke erneut auf Verbinden.',
                es: 'El vínculo con la cuenta Microsoft ha caducado: pulse Conectar de nuevo.',
              }
            : {
                en: 'Xbox Live is unreachable, the local channel still works.',
                fr: 'Xbox Live est injoignable, le canal local fonctionne toujours.',
                de: 'Xbox Live ist nicht erreichbar, der lokale Kanal funktioniert weiterhin.',
                es: 'Xbox Live no está accesible; el canal local sigue funcionando.',
              },
        );
      }
    },

    /** Handler of the `test_connection` manifest action. */
    async testConnection() {
      const { local: onLan, cloud: inAccount, cloudError } = await service.discover();
      await gladys.publishDiscoveredDevices(service.buildDevices());

      // One sentence per check, in every language of the answer.
      const lines = [];
      if (onLan.length > 0) {
        const list = onLan.map((c) => `${c.name} (${c.address})`).join(', ');
        const n = onLan.length;
        lines.push({
          en: `LAN: ${n} console(s) answered: ${list}.`,
          fr: `Réseau local : ${n} console(s) ont répondu : ${list}.`,
          de: `Lokales Netzwerk: ${n} Konsole(n) haben geantwortet: ${list}.`,
          es: `Red local: ${n} consola(s) han respondido: ${list}.`,
        });
      } else {
        lines.push({
          en: 'LAN: no console answered. It must be on, or in "Sleep" (instant-on) power mode.',
          fr: 'Réseau local : aucune console n\'a répondu. Elle doit être allumée, ou en mode d\'alimentation "Veille" (démarrage instantané).',
          de: 'Lokales Netzwerk: Keine Konsole hat geantwortet. Sie muss eingeschaltet sein oder sich im Energiemodus „Ruhemodus“ (Sofort-Ein) befinden.',
          es: 'Red local: ninguna consola ha respondido. Debe estar encendida o en el modo de energía «Suspensión» (inicio instantáneo).',
        });
      }

      if (!auth.hasClient) {
        lines.push({
          en: 'Cloud: not configured (local only).',
          fr: 'Cloud : non configuré (local uniquement).',
          de: 'Cloud: nicht konfiguriert (nur lokal).',
          es: 'Nube: no configurada (solo local).',
        });
      } else if (!auth.isLinked) {
        lines.push({
          en: 'Cloud: Microsoft account not linked, click Connect.',
          fr: 'Cloud : compte Microsoft non relié, cliquez sur Connecter.',
          de: 'Cloud: Microsoft-Konto nicht verknüpft, klicke auf Verbinden.',
          es: 'Nube: cuenta Microsoft no vinculada, pulse Conectar.',
        });
      } else if (cloudError) {
        const reason = cloudError.message;
        lines.push({
          en: `Cloud: error, ${reason}`,
          fr: `Cloud : erreur, ${reason}`,
          de: `Cloud: Fehler, ${reason}`,
          es: `Nube: error, ${reason}`,
        });
      } else {
        const who = auth.identity?.gamertag ?? '?';
        const list = inAccount.map((c) => c.name).join(', ') || '-';
        const n = inAccount.length;
        lines.push({
          en: `Cloud: signed in as ${who}, ${n} console(s): ${list}.`,
          fr: `Cloud : connecté en tant que ${who}, ${n} console(s) : ${list}.`,
          de: `Cloud: angemeldet als ${who}, ${n} Konsole(n): ${list}.`,
          es: `Nube: sesión iniciada como ${who}, ${n} consola(s): ${list}.`,
        });
      }
      await service.reportConnectionStatus();
      return Object.fromEntries(
        Object.keys(lines[0]).map((lang) => [lang, lines.map((line) => line[lang]).join(' ')]),
      );
    },

    /** Transport badge of every console, for publishTransports. */
    transportEntries() {
      return [...consoles.values()]
        .filter((console) => console.transport)
        .map((console) => ({
          external_id: consoleIds(gladys, console.liveId).device,
          ...console.transport,
        }));
    },
  };
  return service;
}
