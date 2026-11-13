# Inside the Straw

A small 3D browser game. A tiny paper traveller runs along the **inside** of giant striped paper drinking straws: floor, walls and ceiling. The straw unravels behind you, and strips of wall peel away ahead of you. Climb round crushed walls, ride a peeled strip as a slide, jump between cut segments, cross a weave as a strand pulls free, and reach the envelope at the end.

Built with Three.js, TypeScript and Vite. No backend, no accounts, no asset files. Play with the keyboard or by tilting a BBC micro:bit v2.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # open the address it prints (http://localhost:5173)
```

```bash
npm run build      # type-checks, then writes the finished game to dist/
npm run preview    # serves dist/ locally to try the build
npm test           # logic tests: course, movement, collapse, micro:bit parser
```

`dist/` is a plain static site with relative paths. Upload it anywhere that serves over **https** (GitHub Pages, Netlify, itch.io).

## Play the slide section directly

The title screen's second button ("Slide section: cut-open straw to bundle, about 40 s") drops you in just before the straw that gets cut open lengthwise: you stay on the one strip that is left, it curls down into a slide, and the slide throws you into the bundle of straws beyond it. That's the sequence this round of changes focused on making readable without the tutorial text.

- Press that button on the title screen, or
- open the game with `?benchmark`, `?slide` or `#slide` on the address, which makes the same button the default Play action.

The full course carries on after it.

## Development diagnostics

Press **F3** (or add `?debug` to the address) during play for an on-screen readout: current sheet/position, whether you're supported, which local events are warning or open, the unravelling front's distance and speed, and a running tally of what's actually caused each fall (`collapse` / `peel` / `tear` / `edge` / `gap` / `short` / `wide` / `step` — the same classification that drives the on-screen "what went wrong" message). Use it to tell a local peel from the pursuing collapse, or to check a checkpoint reset actually put every system back to its starting state.

## Controls

| Action | Keyboard | micro:bit |
| --- | --- | --- |
| Run forward | `W` or `↑` | tilt forward |
| Slow down / brake | release / `S` or `↓` | level / tilt back |
| On a slide | steer with `A` `D`; `S` slows you a little | tilt to steer; tilt back slows a little |
| Walk around the wall (full 360°) | `A` `D` or `←` `→` | tilt left / right |
| Jump | `Space` | button **A** on the micro:bit |
| Pause | `Esc` | `Esc` on the keyboard |

Note: keyboard `A` walks left. Only the micro:bit's round **A** button jumps.

The keyboard keeps working while a micro:bit is connected.

## Make it personal, and tune it

Everything is in **`src/config.ts`**.

- **Gift:** `recipientName`, `giftMessage`, `giftSignature`, colours, whether paper stars appear.
- **`difficulty`:** run speed, wall speed, jump, and the slide numbers (`slideBaseSpeed`, `slideSlopeGain`, `slideMaxSpeed`, `slideBrake`).
- **`collapse`** (the unravelling behind you): `speed`, `startDistance`, `startsAtCheckpoint`, bounded catch-up (`catchUpDistance`, `catchUpBoost`), `mercyDistance`, respawn head start and grace, and the meter and audio thresholds (`meterRange`, `warnDistance`). It only ever advances at a speed; it is never moved forward.
- **`events`** (strips that peel ahead of you): `triggerDistance` (how far ahead the seam starts lifting), `warnSeconds`, `peelSpeed`. Individual events can override these in `src/world/level.ts` — look there for `trigger:` on a specific event if one strip still feels like it goes without enough notice.

The course itself is plain data in `src/world/level.ts`: sheets, crushes, tears, peel events, checkpoints, stars and prompts.

## micro:bit v2

### 1. Put the firmware on the micro:bit

One environment is supported: **MicroPython, using the official editor**.

1. Open <https://python.microbit.org> in Chrome or Edge.
2. Delete the example code and paste in the whole of [`firmware/inside_the_straw.py`](firmware/inside_the_straw.py).
3. Plug the micro:bit in with a USB data cable. Press **Send to micro:bit** and follow the prompts. (Or press **Save** and drag the downloaded `.hex` file onto the `MICROBIT` drive.)
4. The display shows an arrow. The arrow points "forward".
5. Close the editor tab, so it lets go of the serial port.

### 2. Connect in the game

1. Open the game in **Chrome or Edge on a computer**.
2. Press **Connect micro:bit** and choose the device named "BBC micro:bit CMSIS-DAP" (or similar).
3. The test screen opens. Hold the micro:bit flat, lights up, USB cable pointing away from you, and press **Set neutral position**.
4. Tilt it and watch the dot. Press button A and watch the lamp. Adjust **Sensitivity** and **Dead zone** if you like. If a direction feels backwards, tick the matching **Swap** box.
5. Press **Done**, then **Play with micro:bit**.

You can reopen this screen at any time from Pause, then Settings. If the cable comes out mid-game, the game pauses and offers to reconnect or to carry on with the keyboard.

### Browser requirements

The micro:bit link uses the Web Serial API. It needs:

- Chrome or Edge 89+ on Windows, macOS, Linux or ChromeOS. Safari and mobile browsers do not have it.
- A secure context: `https://` or `http://localhost`. Opening `index.html` straight from disk will not work.
- A click: the browser only shows the device picker after you press the button.

Where it is not available, the game says so and plays with the keyboard.

### Serial protocol

- USB serial, **115200 baud**, 8 data bits, no parity, 1 stop bit.
- One JSON object per line, about **50 per second** (every 20 ms):

```
{"s":1042,"x":-48,"y":112,"z":-1008,"a":0,"b":0}
```

| Field | Meaning |
| --- | --- |
| `s` | sequence number, +1 per message, wraps 65535 to 0 |
| `x` `y` `z` | accelerometer in milli-g, micro:bit axes |
| `a` `b` | buttons, `1` while held |

Axis mapping, with the board flat and the USB cable pointing away:

| Game action | Computed from | Sign |
| --- | --- | --- |
| run / brake | pitch = atan2(−y, −z) | tilt forward is positive |
| left / right | roll = atan2(x, −z) | tilt right is positive |

The game subtracts the calibrated neutral pose, applies the dead zone, scales so that 28° is full tilt, and smooths. A jump fires once on the 0 to 1 edge of `a`. If no valid line arrives for 0.4 s the input is treated as neutral.

## How it is put together

| Folder | Job |
| --- | --- |
| `src/config.ts` | Personalisation and difficulty |
| `src/world/sheet.ts` | The surface model. Every walkable thing is a "sheet" with a centre line and a cross-section curvature: a tube is fully curled, a strip is flat, a peel is in between. One coordinate system covers all of them, so the traveller walks from tube to peel to bridge with no special cases. |
| `src/world/sheetMesh.ts`, `paperMaterial.ts` | Geometry and the paper shader. The mesh outline and the collision test come from the same function, so a visible hole is always a real hole. |
| `src/world/level.ts`, `route.ts` | Course data, route progress, and the authored peel events. `Route.solid()` is the one answer to "is there paper here now?" for collision; the shader draws from the same event objects. |
| `src/world/decor.ts`, `world.ts` | The straw landscape, lighting, props |
| `src/player` | Character controller (pure logic) and the animated traveller |
| `src/camera` | Follow camera. Its "up" is the surface under the traveller, so there is nothing to flip at the ceiling. |
| `src/collapse` | The unravelling front and paper fragments |
| `src/input` | Keyboard, micro:bit, serial parser, one shared control format |
| `src/audio` | Synthesised music and effects |
| `src/ui` | Menus, HUD, ending |
| `tests`, `scripts/e2e.mjs`, `scripts/views.mjs` | Logic tests, browser checks, screenshots of chosen spots |

## Credits

See [CREDITS.md](CREDITS.md). Code is MIT licensed.
