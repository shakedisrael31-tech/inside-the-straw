/**
 * The handcrafted course. Distances are metres along each sheet.
 * Colours: 0 red, 1 green, 2 blue, 3 yellow.
 *
 * Every obstacle is one of the paper-straw transformations:
 *   crush      the thin wall pressed in          -> climb round it on the wall
 *   crease     a low fold across the path        -> hop it
 *   tear       a hole with its torn piece hanging -> go round
 *   peel event a strip of wall that lets go ahead of you -> get onto what remains
 *   side peel  a broad strip leaving the wall    -> a slide
 *   lengthwise cut -> trough -> ribbon
 *   weave      over/under mat, one strand pulling free
 *   cut segments, stacked and staggered          -> jumps up and down
 *   split end  three tabs fanning apart          -> a choice
 *
 *  1  Learn            red straw
 *  2  React            green straw: the wall starts letting go
 *  -- benchmark starts (checkpoint 3) --
 *  3  Traverse         peeling floor -> side wall -> slide -> bundle straw -> trough -> woven bridge
 *  -- benchmark ends (checkpoint 4) --
 *  4  Recover/discover staggered stack of cut segments
 *  5  Combine          red straw, split end, second slide
 *  6  The gift         yellow straw (safe)
 */
import type { SheetDef } from './sheet';
import { smoothstep } from '../core/math';

const R1 = 2.2, R3 = 2.0, Q1 = (Math.PI * R1) / 2;   // Q1: a quarter turn up the wall

/** A cut piece of straw in the stack: closed, hollow-ended, and you run along the top of it. */
const segment = (id: string, len: number, color: number, rise: number, side = 0): SheetDef => ({
  id, kind: 'strip', radius: R3, color, open: true, rise, side, path: [{ len }], straw: true,
  curv: [[0, -1 / R3]], halfWidth: [[0, 1.3], [len, 1.3]],
});
const gap = (id: string, len: number, color: number, k = -1 / R3): SheetDef => ({ id, kind: 'void', radius: R3, color, open: true, path: [{ len }], curv: [[0, k]] });

export const COURSE: SheetDef[] = [
  // ── 1 · Learn ───────────────────────────────────────────────
  {
    id: 'T1', kind: 'tube', radius: R1, color: 0,
    path: [{ len: 24 }, { len: 40, yaw: 20 }, { len: 30, pitch: -3 }, { len: 30, yaw: -22, pitch: 3 }],
    crushes: [
      { u: 44, a: 0, lu: 2.8, la: 2.5, depth: 1.5 },
      { u: 57, a: 3.6, lu: 2.6, la: 2.6, depth: 1.5 },
      { u: 85, a: 0, lu: 0.5, la: 3.4, depth: 0.5 },
    ],
    holes: [
      { u: 72, a: 0, lu: 2.2, la: 2.0, tab: true },
      { u: 96, a: 0, lu: 0.8, la: 7, shape: 'rect', rag: 0.08 },
    ],
    tearEnd: 0,
  },
  { id: 'V1', kind: 'void', ring: true, radius: R1, color: 0, path: [{ len: 1.4 }] },
  // ── 2 · React, then the benchmark begins at u = 108 ─────────
  {
    id: 'T2', kind: 'tube', radius: R1, color: 1,
    path: [{ len: 30 }, { len: 45, yaw: -22 }, { len: 35, pitch: -4 }, { len: 8 }],
    tearStart: 0,
    crushes: [
      { u: 50, a: -4.4, lu: 2.4, la: 2.3, depth: 1.5 },
      { u: 51, a: 4.4, lu: 2.4, la: 2.3, depth: 1.5 },
      { u: 101, a: 0.4, lu: 0.5, la: 3.0, depth: 0.5 },
    ],
    holes: [{ u: 92, a: -0.6, lu: 2.0, la: 1.9, tab: true }],
  },
  {
    // Source: the blue straw cut lengthwise. The cut starts on the far wall and widens until
    // only one strip of wall is left. The narrowing shell itself steers you onto that strip,
    // and through the opening you can see the slide and the straw it lands in.
    id: 'OPEN', kind: 'strip', radius: R1, color: 1, open: true, aShift: Q1,
    path: [{ len: 26, pitch: 4, yaw: 5 }],
    curv: [[0, 1 / R1], [15, 1 / R1], [26, 0.3]],
    halfWidth: [[0, 6.88], [7, 5.0], [15, 3.0], [22, 1.9], [26, 1.7]],
  },
  {
    // the same strip, curling away and down: the slide
    id: 'SL1', kind: 'strip', radius: R1, color: 1, open: true, slide: true,
    path: [{ len: 10, roll: -4, yaw: 10, pitch: -10 }, { len: 14, yaw: 36, pitch: -8, roll: -13 }, { len: 12, yaw: -28, pitch: 4, roll: 11 }, { len: 10, yaw: -8, pitch: 12, roll: 0 }],
    curv: [[0, 0.3], [8, 0.17], [40, 0.17], [46, 0.14]],
    halfWidth: [[0, 1.7], [10, 1.75], [46, 1.6]],
  },
  gap('V2', 2.4, 2, 0.14),
  {
    id: 'P2', kind: 'strip', radius: R3, color: 2, open: true, rise: -0.5,
    path: [{ len: 9 }],
    curv: [[0, 0.14], [8, 1 / R3]],
    halfWidth: [[0, 1.6], [9, 2.6]],
  },
  {
    id: 'T3', kind: 'tube', radius: R3, color: 2,
    path: [{ len: 34 }],
    tearStart: 2.6,
    crushes: [{ u: 13, a: 0.3, lu: 2.6, la: 2.3, depth: 1.4 }, { u: 25, a: -3.4, lu: 2.2, la: 2.2, depth: 1.4 }],
  },
  {
    // the straw cut open lengthwise: closed tube -> half-pipe -> narrow ribbon
    id: 'TR', kind: 'strip', radius: R3, color: 2, open: true,
    path: [{ len: 18, pitch: -3 }],
    curv: [[0, 1 / R3], [6, 0.42], [18, 0.05]],
    halfWidth: [[0, 6.26], [6, 4.2], [18, 2.3]],
  },
  {
    id: 'WB', kind: 'weave', radius: R3, color: 3, open: true,
    path: [{ len: 28, yaw: 10, pitch: 3 }],
    halfWidth: [[0, 2.4], [28, 2.4]],
    holes: [
      { u: 11.6, a: -1.6, lu: 0.8, la: 0.8, shape: 'rect', rag: 0.02 },
      { u: 20.4, a: -0.8, lu: 0.8, la: 0.8, shape: 'rect', rag: 0.02 },
    ],
  },
  {
    id: 'PAD', kind: 'strip', radius: R3, color: 3, open: true,
    path: [{ len: 12 }],
    halfWidth: [[0, 2.4], [4, 3.2], [12, 3.0]],
  },
  // ── 4 · The staggered stack ─────────────────────────────────
  gap('G1', 1.8, 0, 0), segment('ST1', 9, 0, -0.6),
  gap('G2', 2.0, 1), segment('ST2', 6.5, 1, 0.5, 0.5),
  gap('G3', 2.0, 2), segment('ST3', 8, 2, -0.5, -0.6),
  gap('G4', 2.0, 3), segment('ST4', 6.5, 3, 0.5, 0.4),
  gap('G5', 1.9, 0), segment('ST5', 9, 2, -0.3, -0.3),
  gap('G6', 2.0, 0, 0),
  // ── 5 · Combine ─────────────────────────────────────────────
  {
    id: 'P5T', kind: 'strip', radius: R1, color: 0, open: true, rise: -0.4,
    path: [{ len: 8 }],
    curv: [[0, 0.14], [7, 1 / R1]],
    halfWidth: [[0, 1.6], [8, 2.7]],
  },
  {
    id: 'T5', kind: 'tube', radius: R1, color: 0,
    path: [{ len: 20 }, { len: 36, yaw: 24 }, { len: 28, yaw: -14, pitch: -3 }],
    tearStart: 2.7,
    crushes: [{ u: 73, a: -0.3, lu: 2.6, la: 2.3, depth: 1.5 }],
    holes: [
      { u: 38, a: 0, lu: 0.85, la: 7, shape: 'rect', rag: 0.08 },
      { u: 66, a: 3.6, lu: 1.9, la: 1.8, tab: true },
    ],
  },
  {
    // cut open like the green straw, this time leaving the strip on the left wall
    id: 'OPEN2', kind: 'strip', radius: R1, color: 0, open: true, aShift: -Q1,
    path: [{ len: 20, roll: 0 }],
    curv: [[0, 1 / R1], [10, 1 / R1], [20, 0.25]],
    halfWidth: [[0, 6.88], [6, 4.8], [13, 3.2], [20, 2.6]],
  },
  {
    // Source: the red straw with its end cut into strips that spread apart. Three tabs from one root.
    id: 'FAN', kind: 'strip', radius: R1, color: 0, open: true,
    path: [{ len: 24, pitch: -3 }],
    curv: [[0, 0.25], [6, 0.06], [24, 0]],
    halfWidth: [[0, 2.6], [8, 4.2], [24, 5.0]],
    holes: [
      { u: 5, a: -2.0, lu: 0, la: 0.1, shape: 'wedge', u1: 25, la1: 0.95, rag: 0.03 },
      { u: 5, a: 2.0, lu: 0, la: 0.1, shape: 'wedge', u1: 25, la1: 0.95, rag: 0.03 },
      { u: 23, a: 3.9, lu: 4.2, la: 2.1, shape: 'rect', rag: 0.1 },
    ],
    // left tab lifts (optional, riskier), right tab droops and stops short, middle tab carries on
    reliefFn: (u, a) => { const k = smoothstep(8, 20, u); return a < -2.0 ? 1.1 * k : a > 2.0 ? -0.8 * k : 0; },
  },
  {
    id: 'SL2', kind: 'strip', radius: R1, color: 0, open: true, slide: true,
    path: [{ len: 10, pitch: -12, yaw: 8, roll: -5 }, { len: 16, yaw: 42, pitch: -6, roll: -13 }, { len: 14, yaw: -16, pitch: 20, roll: 0 }],
    curv: [[0, 0], [5, 0.17], [40, 0.14]],
    halfWidth: [[0, 1.5], [5, 2.1], [40, 1.7]],
  },
  gap('V5', 2.2, 3, 0.14),
  {
    id: 'P6', kind: 'strip', radius: R1, color: 3, open: true, rise: -0.4,
    path: [{ len: 10 }],
    curv: [[0, 0.14], [9, 1 / R1]],
    halfWidth: [[0, 1.6], [10, 2.7]],
  },
  // ── 6 · The gift ────────────────────────────────────────────
  { id: 'T6', kind: 'tube', radius: R1, color: 3, path: [{ len: 34, yaw: -12 }], tearStart: 2.7, tearEnd: 1.7 },
  {
    id: 'END', kind: 'strip', radius: R1, color: 3, open: true,
    path: [{ len: 13 }],
    curv: [[0, 1 / R1], [7, 0]],
    halfWidth: [[0, 1.7], [6, 2.9], [10, 2.9], [12.3, 1.7], [13, 0.5]],
  },
];

/**
 * Authored transformations ahead of the traveller. Each lifts at its seam
 * (warning), then peels along its length. `a`/`w` are the centre and half
 * width of the strip that lets go. Timing defaults are in CONFIG.events.
 */
export interface PeelEventDef { id: string; sheet: string; u0: number; u1: number; a: number; w: number; trigger?: number; warn?: number; speed?: number;
  /** Instead of peeling wall away: lower the whole (unfurlHeight) sheet into place over this many seconds. */
  unfurl?: number }
export const EVENTS: PeelEventDef[] = [
  // the floor peels: take the wall
  { id: 'floor1', sheet: 'T2', u0: 20, u1: 46, a: 0, w: 3.2 },
  // two strips go, leaving one narrow band on each wall
  { id: 'pairA', sheet: 'T2', u0: 60, u1: 84, a: 1.0, w: 3.4 },
  { id: 'pairB', sheet: 'T2', u0: 62, u1: 84, a: -5.9, w: 1.6, trigger: 17 },
  // benchmark: two strands of the woven bridge pull free
  { id: 'strand', sheet: 'WB', u0: 4.8, u1: 28, a: 1.2, w: 0.8, trigger: 11, speed: 6 },
  // combine
  { id: 'floor3', sheet: 'T5', u0: 16, u1: 34, a: 0.6, w: 3.0 },
  { id: 'pairC', sheet: 'T5', u0: 46, u1: 62, a: -0.4, w: 3.0 },
  { id: 'pairD', sheet: 'T5', u0: 47, u1: 62, a: 5.9, w: 1.4, trigger: 16 },
];

export interface Mark { sheet: string; u: number }
/** Checkpoints, in order. The traveller restarts at the latest one reached. */
export const CHECKPOINTS: Mark[] = [
  { sheet: 'T1', u: 104 },
  { sheet: 'T2', u: 4 },
  { sheet: 'T2', u: 104 },
  { sheet: 'PAD', u: 3 },
  { sheet: 'P5T', u: 3 },
  { sheet: 'OPEN2', u: 14 },
];
/** Index (0-based) of the checkpoints that bracket the benchmark section. */
export const BENCHMARK = { startCheckpoint: 2, endCheckpoint: 3 };
/** The unravelling never enters the last straw: that is the safe ending area. */
export const SAFE_FROM: Mark = { sheet: 'T6', u: 2 };
export const FINISH: Mark = { sheet: 'END', u: 7.5 };
export const ENVELOPE: Mark = { sheet: 'END', u: 10.6 };

/**
 * Camera reveals: at these stretches the camera eases back, up and a little to one side so the whole
 * material experiment is in view (the cut-open straw, the bundle, the weave, the stack, the split end),
 * then eases back to the normal follow view. Offsets in metres; `to` may be on a later sheet.
 */
export interface RevealDef { from: Mark; to: Mark; back: number; up: number; side: number }
export const REVEALS: RevealDef[] = [
  // the peeled wall and its slide: kept gentler than the other reveals because this one overlaps the
  // slide's own camera widening (see FollowCamera) - stacking two big offsets here was tilting the
  // horizon hard and shrinking the traveller right as the slide began
  { from: { sheet: 'OPEN', u: 12 }, to: { sheet: 'SL1', u: 9 }, back: 1.8, up: 1.7, side: -1.2 },
  { from: { sheet: 'SL1', u: 30 }, to: { sheet: 'P2', u: 3 }, back: 2.0, up: 2.4, side: 1.5 },        // the bundle you are about to land in
  { from: { sheet: 'TR', u: 9 }, to: { sheet: 'WB', u: 5 }, back: 3.0, up: 3.6, side: 2.4 },          // the weave
  { from: { sheet: 'PAD', u: 2 }, to: { sheet: 'PAD', u: 11 }, back: 3.6, up: 3.4, side: -2.6 },      // the stack
  { from: { sheet: 'OPEN2', u: 13 }, to: { sheet: 'FAN', u: 7 }, back: 3.2, up: 3.6, side: 0 },       // the split end
  { from: { sheet: 'SL2', u: 30 }, to: { sheet: 'P6', u: 3 }, back: 2.0, up: 2.2, side: -1.2 },
];

export interface StarDef { sheet: string; u: number; a: number; h?: number }
const arc = (sheet: string, u0: number, a0: number, u1: number, a1: number, n: number, h?: number): StarDef[] =>
  Array.from({ length: n }, (_, i) => ({ sheet, u: u0 + ((u1 - u0) * i) / (n - 1), a: a0 + ((a1 - a0) * i) / (n - 1), h }));
/** Stars teach and tempt: they trace wall routes and jump arcs, and reward the harder line. */
export const STARS: StarDef[] = [
  ...arc('T1', 38, -1.6, 44, -3.4, 3),                 // up the wall, round the first crush
  { sheet: 'T1', u: 96, a: 0, h: 1.0 },                // the arc of the first jump
  { sheet: 'T1', u: 85, a: 6.9 },                      // on the ceiling, for the curious
  ...arc('T2', 22, 4.2, 36, 6.6, 3),                   // high line over the peeling floor
  { sheet: 'T2', u: 68, a: 5.4 }, { sheet: 'T2', u: 78, a: 5.4 },     // the higher of the two surviving bands
  ...arc('OPEN', 9, 0, 23, 0, 3),                       // the one strip that stays: a short trail onto the slide
  ...arc('SL1', 12, -0.7, 24, 0.7, 3), { sheet: 'SL1', u: 38, a: 0 },      // steer the slide; the last one marks the take-off
  { sheet: 'V2', u: 1.2, a: 0, h: 0.9 },
  { sheet: 'T3', u: 13, a: -3.6 }, { sheet: 'T3', u: 25, a: 6.2 },
  { sheet: 'WB', u: 16, a: -1.6 }, { sheet: 'WB', u: 24, a: 1.2, h: 0.5 },  // the second is over the strand that leaves
  { sheet: 'G2', u: 1.0, a: 0, h: 1.2 }, { sheet: 'G4', u: 1.0, a: 0, h: 1.3 }, { sheet: 'ST3', u: 4, a: 0.9 },
  ...arc('T5', 16, -3.4, 26, -5.2, 3),
  { sheet: 'T5', u: 52, a: -5.2 }, { sheet: 'T5', u: 56, a: 3.5 },
  ...arc('FAN', 14, -3.3, 23, -3.6, 3, 0.55), { sheet: 'FAN', u: 17.5, a: 3.5 },   // the raised tab, and the short one
  ...arc('SL2', 12, -0.6, 24, -0.9, 3),
  { sheet: 'T6', u: 16, a: 3.4 }, { sheet: 'T6', u: 24, a: -3.4 },
];

export type PromptKey = 'run' | 'brake' | 'around' | 'holes' | 'jump' | 'collapse' | 'peelfloor' | 'band' | 'toSlide' | 'slide' | 'gap' | 'weave' | 'rest' | 'stack' | 'exit' | 'tabs' | 'safe';
export interface PromptDef { sheet: string; u0: number; u1: number; key: PromptKey }
export const PROMPTS: PromptDef[] = [
  { sheet: 'T1', u0: 0, u1: 18, key: 'run' },
  { sheet: 'T1', u0: 20, u1: 32, key: 'brake' },
  { sheet: 'T1', u0: 33, u1: 50, key: 'around' },
  { sheet: 'T1', u0: 62, u1: 76, key: 'holes' },
  { sheet: 'T1', u0: 78, u1: 98, key: 'jump' },
  { sheet: 'T1', u0: 104, u1: 116, key: 'collapse' },
  { sheet: 'T2', u0: 3, u1: 20, key: 'peelfloor' },
  { sheet: 'T2', u0: 46, u1: 62, key: 'band' },
  { sheet: 'T2', u0: 106, u1: 118, key: 'toSlide' },
  { sheet: 'OPEN', u0: 0, u1: 14, key: 'toSlide' },
  { sheet: 'SL1', u0: 0, u1: 16, key: 'slide' },
  { sheet: 'SL1', u0: 36, u1: 46, key: 'gap' },
  { sheet: 'WB', u0: 0, u1: 10, key: 'weave' },
  { sheet: 'PAD', u0: 3, u1: 12, key: 'rest' },
  { sheet: 'ST1', u0: 0, u1: 8, key: 'stack' },
  { sheet: 'OPEN2', u0: 0, u1: 12, key: 'exit' },
  { sheet: 'FAN', u0: 0, u1: 12, key: 'tabs' },
  { sheet: 'T6', u0: 3, u1: 16, key: 'safe' },
];
