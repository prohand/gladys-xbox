# Xbox integration

Control your Xbox consoles (Xbox One, Xbox Series X|S) from Gladys: turn them on
and off, see whether they are on and which game is being played, use them in
scenes and on the dashboard.

## Two channels

| Channel                  | Needs               | What it does                                                                                               |
| ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Local** (your network) | nothing             | finds the consoles, sees whether they are on, turns them on                                                |
| **Cloud** (Xbox Live)    | a Microsoft account | everything above, plus: turn off, volume, mute, media keys, controller buttons, launch a game, game played |

You can use the local channel alone, the cloud channel alone, or both. With
both, the **Prefer the local connection** switch of the configuration picks the
one asked first; the other one takes over when the first does not answer. The
badge of each console says which channel served it last (orange dot: the cloud
serves a console the local search did not find).

## Prepare the console

1. **Power mode**: Settings → General → Power options → **Sleep** (Xbox Series)
   or **Instant-on** (Xbox One). In "Shut down (energy saving)" mode the console
   cannot be turned on from the network, by any channel.
2. **Remote features** (cloud channel): Settings → Devices & connections →
   Remote features → tick **Enable remote features**.
3. In the same screen, under **Xbox app preferences**, choose **Allow
   connections from any device**: it helps the local channel.

## Local channel

Nothing to fill in: open the integration, click **Test the connection and search
for consoles**, then create your consoles in the **Discovery** tab.

The search asks Gladys to send a SmartGlass discovery on UDP port 5050 of your
network (Gladys shows this permission when you install the integration). A
console on another subnet, or behind a router that filters broadcasts, is not
found that way: type its IP address in **Console IP addresses** (several
addresses separated by commas). Give the console a fixed address in your router
so it does not change.

## Cloud channel

The cloud channel signs in to Xbox Live with your Microsoft account, through an
application **you** register at Microsoft (free). Gladys never sees your
password.

1. Open the [Azure portal](https://portal.azure.com) → **App registrations** →
   **New registration**.
   - Name: `Gladys Xbox` (anything).
   - Supported account types: **Personal Microsoft accounts only** (or "any
     organizational directory and personal Microsoft accounts").
   - Redirect URI: platform **Web**, address: the one of the Gladys **Connect**
     button (see below).
2. In the application, copy the **Application (client) ID**.
3. **Certificates & secrets** → **New client secret** → copy its **Value** (not
   its ID: the value is only shown once).
4. In Gladys, paste the two values in **Application (client) ID** and **Client
   secret**, save, then click **Connect** next to **Microsoft account** and sign
   in.

**Which redirect URI?** The integration writes it in its logs when you click
Connect (`Redirect URI to register in Azure: …`), and Microsoft shows it in the
error page if it is not registered yet. Microsoft only accepts an **https**
address (or `http://localhost`): open Gladys through its https address (Gladys
Plus, your reverse proxy) when you click Connect.

The link lasts: the integration renews its access by itself. If the
configuration shows "The Microsoft account link expired", click **Connect**
again.

## The console in Gladys

Each console is a television-type device:

- **Power**: on/off. On: local packet or cloud, by preference. Off: cloud only.
- **Mute**, **Volume up / down**, **Play**, **Pause**, **Previous**, **Next**,
  the arrows, **A (select)**, **B (back)**, **Menu**, **View**, **Xbox button
  (guide)**: cloud only.
- **Game being played**: the name of the game or app in the foreground, `-` on
  the home screen or when the console is off (cloud only).

The console is read every 60 seconds by default (**Refresh interval**, 30
seconds minimum), and again within 30 seconds after a command.

## Scenes

Triggers:

- **A game starts on an Xbox**: filter on the console and on the exact game
  name. Variables: `title_name`, `title_id`.
- **A game stops on an Xbox**: same filters. Variables: `title_name`,
  `title_id`, `played_minutes`.

Use them in the next actions as `{{triggerEvent.data.title_name}}`, e.g. send
"Lucas played 95 minutes of Minecraft" by message.

Actions:

- **Turn on an Xbox and wait**: turns the console on, then waits until it
  answers (up to 100 s). Output `awake` (true / false) to gate the next actions.
- **Launch a game on an Xbox**: by its Microsoft Store product ID, the 12
  characters at the end of the game page address on xbox.com, e.g.
  `xbox.com/…/games/store/<name>/9NBLGGH2JHXJ`. Output `launched`.
- **Press a controller button**: A, B, X, Y, arrows, Xbox button, View, Menu.
  Output `pressed`.

The power, mute and keys are also available in the standard "Control a device"
action, and the power state in the standard "Device state" trigger.

The game being played comes from the **presence of your Xbox Live account**, not
from one console: with several consoles on at the same time, they all show the
game of the linked account.

## Dashboard widget

Add the **Xbox console** widget and pick a console (the first one by default):
power, game being played, connection, account, and quick buttons — turn on, and
with the cloud channel: home, play/pause, turn off.

## Troubleshooting

- **No console found**: is it on, or in Sleep / Instant-on mode? Is Gladys on
  the same network? Try typing its IP address.
- **The console does not turn on**: check the power mode (Sleep / Instant-on).
  On the local channel, the console must have answered at least once so its
  Live ID is known.
- **"needs the cloud channel"**: turning off and the keys need the Microsoft
  account.
- **The commands do nothing**: enable the remote features on the console.
- **Logs**: Gladys → Integrations → Xbox → logs. They never contain your tokens
  nor your secret.
