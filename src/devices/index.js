// -----------------------------------------------------------------------------
// Device dispatch helpers.
//
// The consoles are not a fixed list: they come from the LAN discovery and from
// the Microsoft account (see src/xbox/service.js). This module only holds the
// poll pacing shared by all of them.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';

export * from './console.js';

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-tick runs now, so a 60 s interval does not slip to 90 s.
const POLL_TOLERANCE_MS = DEVICE_POLL_FREQUENCIES.EVERY_30_SECONDS / 2;

/**
 * Create the `onPoll` pacer: run `read(device)` at the refresh interval the
 * user chose (`poll_frequency` config, in seconds).
 *
 * Gladys polls a device at a fixed pace, read once when the device is created
 * (every 30 s here). The slower interval of the config is applied by skipping
 * the polls in between: the user can change it at any time, without
 * re-creating the devices.
 *
 * Resolves `true` when the device was read, `false` when the poll was skipped.
 * A read that throws is retried at the next poll.
 */
export function createPoller({ now = Date.now } = {}) {
  const lastReads = new Map();
  const poll = async function pollDevice(device, config, read) {
    const time = now();
    const lastRead = lastReads.get(device.external_id);
    if (
      lastRead !== undefined &&
      time - lastRead < config.poll_frequency * 1000 - POLL_TOLERANCE_MS
    ) {
      return false;
    }
    await read(device);
    lastReads.set(device.external_id, time);
    return true;
  };
  // A command changed the console: read it again at the next poll.
  poll.forget = (externalId) => lastReads.delete(externalId);
  return poll;
}
