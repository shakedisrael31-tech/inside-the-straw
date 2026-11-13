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

  /** Difficulty. Distances in metres, speeds in metres per second. */
  difficulty: {
    /** Traveller top running speed. */
    maxSpeed: 4.6,
    /** Speed of travel around the wall. */
    lateralSpeed: 4.4,
    jumpSpeed: 5.4,
    gravity: 14.5,
    /** Slides: speed on the flat, extra speed per unit of slope, the cap, and how much braking can take off. */
    slideBaseSpeed: 4.4,
    slideSlopeGain: 17,
    slideMaxSpeed: 8.6,
    slideBrake: 0.4,
  },

  /** The unravelling that follows you. */
  collapse: {
    /** It starts once this checkpoint (1-based) is reached... */
    startsAtCheckpoint: 1,
    /** ...this far behind you. */
    startDistance: 30,
    /** Base speed. A steady player averages about 3.6 to 4; top running speed is 4.6. */
    speed: 3.1,
    /** If you get further ahead than this it speeds up, smoothly, by up to catchUpBoost. It never jumps forward. */
    catchUpDistance: 26,
    catchUpBoost: 1.3,
    /** When it is this close it eases off a little: tense, never cruel. */
    mercyDistance: 6,
    mercyFactor: 0.85,
    /** How far behind you it is placed after a respawn, and how long it then waits. */
    respawnHeadStart: 22,
    respawnGrace: 1.5,
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
    /** How fast the peel runs along the strip. Faster than you can run, so it always opens ahead of you. */
    peelSpeed: 9,
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
