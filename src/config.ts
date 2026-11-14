/**
 * ─────────────────────────────────────────────────────────────
 *  INSIDE THE STRAW — personalisation
 *  Everything you are likely to want to change lives in this file.
 * ─────────────────────────────────────────────────────────────
 */
export const CONFIG = {
  /** Who the game is for. Leave empty ('') for a gift with no name on it. */
  recipientName: '',

  /** The letter inside the envelope at the end. One string per paragraph. */
  giftMessage: [
    'You made it all the way through.',
    'This little world was built from paper straws, cut, peeled and woven by hand, and it was made for you.',
    'Thank you for being someone worth making things for.',
  ],
  /** Signature under the letter. Leave empty to hide it. */
  giftSignature: 'With love',

  /** Optional paper stars to collect along the way. */
  collectibles: { enabled: true, label: 'Paper stars' },

  /** Straw colours (the four stripe inks, the paper, and the sky). */
  colors: {
    red: '#d8473d',
    green: '#2f9d58',
    blue: '#2f5fc4',
    yellow: '#f2c230',
    paper: '#f6efe0',
    skyTop: '#9cc7e6',
    skyHorizon: '#fbe9c9',
    ground: '#efe2c8',
  },

  /**
   * Difficulty. Distances in metres, speeds in metres per second.
   *
   * `pace` is the one knob for "the game feels slow/fast": it scales running
   * speed, lateral speed and acceleration together, so the traveller stays
   * coherent at any value. Jumping and sliding are deliberately NOT scaled
   * by it (see jumpSpeed/slide* below) - they were tuned against the actual
   * course geometry and a blind multiply would overshoot landings.
   */
  difficulty: {
    /** Overall running pace multiplier. 1 = the original pace; 1.12 = +12%. */
    pace: 1.12,
    /** Traveller top running speed, before `pace`. */
    maxSpeed: 4.6,
    /** Speed of travel around the wall, before `pace`. */
    lateralSpeed: 4.4,
    /** Ground/air acceleration, deceleration and braking, before `pace`. Scaled with
     *  maxSpeed so time-to-top-speed (and the running animation driven by it) stays
     *  the same feel at the new pace, just faster. */
    accel: 7, decel: 4.2, brake: 13, lateralAccel: 26, airLateralAccel: 12,
    /** Jump take-off speed and gravity. Left as-is: jump arcs were tuned against the
     *  level's actual landings, and the forward boost on take-off already scales with
     *  maxSpeed, so jumps carry a little further at the new pace without being retuned. */
    jumpSpeed: 5.4,
    gravity: 14.5,
    /** Slides: speed on the flat, extra speed per unit of slope, the cap, and how much braking
     *  can take off. Left exactly as before - the slide already feels distinct and intentionally
     *  isn't part of the running-pace change. */
    slideBaseSpeed: 4.4,
    slideSlopeGain: 17,
    slideMaxSpeed: 8.6,
    slideBrake: 0.4,
  },

  /**
   * The unravelling that follows you. These are grouped so movement pace (above), chase speed,
   * starting gap and checkpoint grace can each be read and adjusted on their own line.
   */
  collapse: {
    /** It starts once this checkpoint (1-based) is reached... */
    startsAtCheckpoint: 1,
    /** ...this far behind you (the starting gap). */
    startDistance: 30,
    /** Base chase speed. Deliberately a bigger fraction of the new top speed than before
     *  (was 0.67x maxSpeed; now ~0.76x of the paced maxSpeed) so it catches up more
     *  decisively instead of just scaling with the player's own faster pace. */
    speed: 3.9,
    /** If you get further ahead than this it speeds up, smoothly, by up to catchUpBoost. It never
     *  jumps forward. Set at the starting gap itself, so a player who just holds a comfortable,
     *  steady pace (well under top speed) keeps that starting gap rather than slowly losing it -
     *  only pulling the lead out further triggers extra pressure. speed + catchUpBoost is also
     *  kept comfortably below the paced maxSpeed, so a player who keeps running flat out can
     *  never actually be run down. */
    catchUpDistance: 30,
    catchUpBoost: 1.1,
    /** When it is this close it eases off a little: tense, never cruel. */
    mercyDistance: 6,
    mercyFactor: 0.85,
    /** How far behind you it is placed after a respawn (checkpoint grace distance), and how
     *  long it then waits (checkpoint grace time). Both nudged up a little to keep recovery
     *  fair now that the base chase speed is higher. */
    respawnHeadStart: 25,
    respawnGrace: 1.7,
    /** Meter and audio thresholds: the meter starts to fill at meterRange; tearing is audible from warnDistance. */
    meterRange: 30,
    warnDistance: 22,
  },

  /** Authored peels ahead of you (per-event overrides live in src/world/level.ts). */
  events: {
    /** How far before the strip the warning starts. Long enough that a player glancing, not
     *  staring, at the route still sees the seam lift before it is their only lane. */
    triggerDistance: 19,
    /** Seconds the seam lifts and rustles before the strip lets go. */
    warnSeconds: 1.3,
    /** How fast the peel runs along the strip. Kept comfortably faster than the new running
     *  pace, so it still always opens ahead of you rather than merely keeping up. */
    peelSpeed: 10,
  },

  /** micro:bit tilt defaults (all adjustable in the in-game settings). */
  microbit: {
    /** Tilt angle in degrees that counts as "fully tilted". */
    fullTiltDegrees: 28,
    deadZoneDegrees: 4,
    smoothing: 0.35,
  },
} as const;

export type Palette = [string, string, string, string];
export const STRIPE_COLORS: Palette = [CONFIG.colors.red, CONFIG.colors.green, CONFIG.colors.blue, CONFIG.colors.yellow];
