// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
// The manifest `widgets` field declares the identity (key, label, icon, the
// per-instance `settings`); at runtime the integration returns a DECLARATIVE
// content that the core renders with its own theme, dark mode and
// translations. No HTML, no CSS.
//
// Each entry of WIDGETS is keyed by the widget `key` and exposes:
//   - get(service, { settings }): the content (`gladys.onWidgetGet`);
//   - action(service, { actionKey, params }) (optional): a tapped `button`
//     carrying an `action` (`gladys.onWidgetAction`).
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURES, consoleIds } from './devices/console.js';

const logger = createLogger({ name: 'widgets' });

// Widget key, as declared in the manifest `widgets` field.
export const CONSOLE_WIDGET = 'xbox_console';

// Keys of the `button` actions the content declares.
export const CONSOLE_ACTIONS = { HOME: 'home', PLAY_PAUSE: 'play_pause' };

const POWER_STATUS = {
  on: { value: { en: 'On', fr: 'Allumée' }, color: WIDGET_COLORS.SUCCESS },
  standby: { value: { en: 'Standby', fr: 'En veille' }, color: WIDGET_COLORS.WARNING },
  off: { value: { en: 'Off', fr: 'Éteinte' }, color: WIDGET_COLORS.NEUTRAL },
  unknown: { value: { en: 'Unknown', fr: 'Inconnu' }, color: WIDGET_COLORS.NEUTRAL },
};

const TRANSPORT_STATUS = {
  [DEVICE_TRANSPORTS.LOCAL]: { value: { en: 'Local', fr: 'Locale' }, color: WIDGET_COLORS.SUCCESS },
  [DEVICE_TRANSPORTS.CLOUD]: { value: { en: 'Cloud', fr: 'Cloud' }, color: WIDGET_COLORS.INFO },
  [DEVICE_TRANSPORTS.UNREACHABLE]: {
    value: { en: 'Unreachable', fr: 'Injoignable' },
    color: WIDGET_COLORS.DANGER,
  },
};

function transportStatus(transport) {
  if (!transport) {
    return { value: { en: 'Not read yet', fr: 'Pas encore lue' }, color: WIDGET_COLORS.NEUTRAL };
  }
  const { value, color } = TRANSPORT_STATUS[transport.transport];
  if (transport.degraded) {
    return {
      value: { en: `${value.en} (degraded)`, fr: `${value.fr} (dégradée)` },
      color: WIDGET_COLORS.WARNING,
    };
  }
  return { value, color };
}

// Texts of a status row hold 40 characters at most.
const short = (text, max = 40) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The console a widget instance shows: the one picked in its settings, or the first one. */
function pickConsole(service, settings) {
  if (settings?.device) {
    return service.findConsole(settings.device);
  }
  return service.consoles[0] ?? null;
}

export const WIDGETS = {
  [CONSOLE_WIDGET]: {
    async get(service, { settings }) {
      logger.debug(`onWidgetGet <- ${CONSOLE_WIDGET}`);
      const console = pickConsole(service, settings);
      if (!console) {
        return {
          ttl_seconds: 300,
          components: [
            {
              type: 'text',
              variant: 'body',
              text: {
                en: 'No console yet: run "Test the connection" in the integration, then create the console in the Discovery tab.',
                fr: "Aucune console pour l'instant : lancez « Tester la connexion » dans l'intégration, puis créez la console dans l'onglet Découverte.",
              },
            },
          ],
        };
      }

      const ids = consoleIds(service.gladys, console.liveId);
      const powerKey = console.power ?? 'unknown';
      const isOn = console.power === 'on';
      const cloudLinked = service.cloudLinked;

      const buttons = [];
      if (!isOn) {
        // Bound to the device feature: the tap goes through onSetValue, like
        // the power switch of the TV widget.
        buttons.push({
          type: 'button',
          label: { en: 'Turn on', fr: 'Allumer' },
          icon: 'power',
          style: 'primary',
          device_feature: ids.feature(FEATURES.POWER),
          value: 1,
        });
      } else if (cloudLinked) {
        buttons.push(
          {
            type: 'button',
            label: { en: 'Home', fr: 'Accueil' },
            icon: 'home',
            style: 'secondary',
            action: { key: CONSOLE_ACTIONS.HOME, params: { device: ids.device } },
          },
          {
            type: 'button',
            label: { en: 'Play / pause', fr: 'Lecture / pause' },
            icon: 'play',
            style: 'secondary',
            action: { key: CONSOLE_ACTIONS.PLAY_PAUSE, params: { device: ids.device } },
          },
          {
            type: 'button',
            label: { en: 'Turn off', fr: 'Éteindre' },
            icon: 'power',
            style: 'danger',
            device_feature: ids.feature(FEATURES.POWER),
            value: 0,
            confirm: true,
          },
        );
      }

      const items = [
        {
          label: { en: 'Console', fr: 'Console' },
          icon: 'monitor',
          value: short(console.name),
          color: WIDGET_COLORS.NEUTRAL,
        },
        { label: { en: 'Power', fr: 'Alimentation' }, icon: 'power', ...POWER_STATUS[powerKey] },
        {
          label: { en: 'Playing', fr: 'En cours' },
          icon: 'play-circle',
          value: console.title ? short(console.title.name) : '-',
          color: console.title ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
        },
        {
          label: { en: 'Connection', fr: 'Connexion' },
          icon: 'wifi',
          ...transportStatus(console.transport),
        },
      ];
      const gamertag = service.gamertag;
      if (gamertag) {
        items.push({
          label: { en: 'Account', fr: 'Compte' },
          icon: 'user',
          value: short(gamertag),
          color: WIDGET_COLORS.INFO,
        });
      }

      return {
        // The service nudges the widget whenever the power, the game or the
        // transport changes (see refreshWidgets): the TTL is a safety net.
        ttl_seconds: 120,
        components: [{ type: 'status', items }, ...buttons],
      };
    },

    // Resolve an optional toast (≤ 200 characters). After a successful action
    // the core drops the cached content and every open dashboard refetches it.
    async action(service, { actionKey, params }) {
      logger.info(`onWidgetAction <- ${CONSOLE_WIDGET}.${actionKey}`);
      const console = service.findConsole(params.device);
      if (!console) {
        throw new Error('This console no longer exists.');
      }
      if (actionKey === CONSOLE_ACTIONS.HOME) {
        await service.goHome(console);
        return { en: 'Back to the home screen', fr: "Retour à l'écran d'accueil" };
      }
      if (actionKey === CONSOLE_ACTIONS.PLAY_PAUSE) {
        await service.playPause(console);
        return { en: 'Play / pause sent', fr: 'Lecture / pause envoyée' };
      }
      // Throwing acks the action as failed: the message reaches the user.
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
};

/**
 * Freshness nudge: ask the core to re-pull every widget NOW instead of waiting
 * for the content TTL. Fire-and-forget: rate-limited core-side to 1 per 10 s
 * per widget, dropped silently while disconnected.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
