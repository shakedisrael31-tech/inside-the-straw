/**
 * The paper-straw material: thin cream paper with one wide diagonal ink
 * stripe, a faint spiral construction seam, fibres at two scales, and light
 * glowing through the wall. The stripe is computed from surface coordinates
 * (route distance, arc length), so a strip peeled from a straw carries on
 * its parent's pattern exactly.
 *
 * The same shader performs both kinds of unravelling, from the same
 * numbers collision uses:
 *   - the pursuing front (uFront): the wall splits along its spiral seam
 *     into ribbons that flare, droop and thin out;
 *   - authored peel events (uEvA/uEvB): a strip lifts at its seam, then
 *     hangs away from the wall along its length, leaving a clean slit.
 */
import {
  CanvasTexture, Color, MeshDepthMaterial, MeshStandardMaterial, RepeatWrapping, RGBADepthPacking,
  Vector3, Vector4, type IUniform, type Texture, NoColorSpace, FrontSide,
} from 'three';
import { CONFIG, STRIPE_COLORS } from '../config';
import { rng } from '../core/math';

export const EVENT_SLOTS = 6;
export interface PaperShared {
  uFront: IUniform<number>; uTime: IUniform<number>; uSunDir: IUniform<Vector3>;
  uFiber: IUniform<Texture>; uPaper: IUniform<Color>; uPal: IUniform<Color[]>;
  /** per slot: (s0, s1, centre a, half width) and (peel front s, seam lift 0..1, 0, 0) */
  uEvA: IUniform<Vector4[]>; uEvB: IUniform<Vector4[]>;
}

function fiberTexture(): Texture {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!, r = rng(7);
  g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = r() * S, y = r() * S, rad = 14 + r() * 40, v = Math.floor(96 + r() * 64);
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(128,${v},128,0.5)`); gr.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  for (let i = 0; i < 3400; i++) {
    const x = r() * S, y = r() * S, len = 3 + r() * 16, ang = r() * Math.PI, v = r() < 0.5 ? 30 + r() * 50 : 190 + r() * 60;
    g.strokeStyle = `rgba(${v | 0},128,128,${0.12 + r() * 0.25})`; g.lineWidth = 0.5 + r() * 0.8;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      g.beginPath(); g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + Math.cos(ang) * len * 0.5 + (r() - 0.5) * 4, y + oy + Math.sin(ang) * len * 0.5 + (r() - 0.5) * 4, x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
      g.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = NoColorSpace; t.anisotropy = 4;
  return t;
}

export function createShared(): PaperShared {
  return {
    uFront: { value: -1e6 }, uTime: { value: 0 }, uSunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
    uFiber: { value: fiberTexture() },
    uPaper: { value: new Color(CONFIG.colors.paper) },
    uPal: { value: STRIPE_COLORS.map((c) => new Color(c)) },
    uEvA: { value: Array.from({ length: EVENT_SLOTS }, () => new Vector4(0, 0, 0, 0)) },
    uEvB: { value: Array.from({ length: EVENT_SLOTS }, () => new Vector4(0, 0, 0, 0)) },
  };
}

const EV_DECL = /* glsl */ `
uniform vec4 uEvA[${EVENT_SLOTS}]; uniform vec4 uEvB[${EVENT_SLOTS}]; uniform float uCirc;
float evAcross(float a, vec4 A) { float da = a - A.z; if (uCirc > 0.0) da = mod(da + 0.5 * uCirc, uCirc) - 0.5 * uCirc; return A.w - abs(da); }
`;
const VERT_DECL = /* glsl */ `
attribute vec2 aCoord; attribute vec2 aPat; attribute vec3 aOut; attribute vec3 aTan; attribute float aFace; attribute float aShade;
uniform float uFront, uTime, uSlope, uPitch, uCollapse, uRad;
varying vec2 vCoord; varying vec2 vPat; varying float vFace; varying float vD; varying vec3 vOutW; varying float vShade;
` + EV_DECL;
const VERT_MAIN = /* glsl */ `
vCoord = aCoord; vPat = aPat; vFace = aFace; vShade = aShade;
vOutW = normalize(mat3(modelMatrix) * aOut);
{
  float hc = (aCoord.x - uSlope * aCoord.y) / uPitch;
  float dd = (uFront - aCoord.x - (0.9 + 0.9 * sin(hc * 6.2831853 + 1.3))) * uCollapse;
  vD = dd;
  if (dd > 0.0) {
    float t = min(dd, 18.0);
    float vary = 0.7 + 0.3 * sin(hc * 18.85 + 0.7);
    float flare = (1.0 - exp(-t * 0.28)) * uRad * 1.5 * vary + sin(uTime * 2.4 + hc * 9.0 + aCoord.x * 0.6) * 0.09 * min(t, 2.5);
    transformed += aOut * flare;
    transformed.y -= 0.028 * t * t;
  }
  if (uCollapse > 0.5) for (int i = 0; i < ${EVENT_SLOTS}; i++) {
    vec4 A = uEvA[i]; vec4 Bv = uEvB[i];
    if (A.w <= 0.0 || aCoord.x < A.x || aCoord.x > A.y) continue;
    float e = evAcross(aCoord.y, A);
    if (e <= 0.0) continue;
    float edge = smoothstep(0.0, 0.42, e);
    // warning: the seam lifts and shivers
    transformed += aOut * (Bv.y * edge * (0.07 + 0.05 * sin(uTime * 11.0 + aCoord.x * 2.3)));
    // consequence: behind the peel line the strip curls away from the wall like a skin, hinged where the
    // peel has reached. The bend is integrated along the strip, so it curls; it does not swing as a plank.
    float d = Bv.x - aCoord.x;
    if (d > 0.0) {
      float seg = d / 6.0, x = 0.0, y = 0.0;
      for (int k = 0; k < 6; k++) { float th = 2.9 * (1.0 - exp(-(float(k) + 0.5) * seg / 3.6)); x += cos(th) * seg; y += sin(th) * seg; }
      transformed += (aTan * (d - x) + aOut * y) * edge * smoothstep(A.x, A.x + 0.45, aCoord.x);
    }
  }
}
`;
const FRAG_DECL = /* glsl */ `
uniform float uSlope, uPitch, uGlow, uCollapse, uTime, uBump;
uniform vec3 uTint, uPaper, uSunDir; uniform vec3 uPal[4]; uniform sampler2D uFiber;
varying vec2 vCoord; varying vec2 vPat; varying float vFace; varying float vD; varying vec3 vOutW; varying float vShade;
float ihash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// paper surface height: fine fibre grain plus the soft crumple of a handled straw
float paperHeight(vec2 p) { return texture2D(uFiber, p * 0.83 + 0.11).r * 0.5 + texture2D(uFiber, p * 0.21).r * 0.9 + texture2D(uFiber, p * 0.06 + 0.4).g * 1.3; }
` + EV_DECL;
const DISCARD = /* glsl */ `
float evCrease = 0.0, evRim = 0.0;
if (vD > 0.0) {
  float fb = fract((vCoord.x - uSlope * vCoord.y) / uPitch * 3.0);
  float gap = clamp(vD * 0.045, 0.0, 0.3);
  if (fb < gap || fb > 1.0 - gap) discard;
  if (vD > 8.0 + 7.0 * ihash(floor(gl_FragCoord.xy * 0.5))) discard;
}
if (uCollapse > 0.5) for (int i = 0; i < ${EVENT_SLOTS}; i++) {
  vec4 A = uEvA[i]; vec4 Bv = uEvB[i];
  if (A.w <= 0.0 || vCoord.x < A.x - 0.1 || vCoord.x > A.y) continue;
  float e = evAcross(vCoord.y, A);
  bool open = Bv.x > vCoord.x && vCoord.x >= A.x;
  if (e > 0.0) {
    // the slit: a clean gap along both sides of the strip and at its free end
    if (open && (e < 0.42 || vCoord.x < A.x + 0.45)) discard;
    if (!open) evCrease = max(evCrease, Bv.y * (1.0 - smoothstep(0.0, 0.09, e)));
  } else if (e > -0.07) {
    if (open) evRim = 1.0; else evCrease = max(evCrease, Bv.y * 0.8);
  }
}
`;
const FRAG_COLOR = /* glsl */ `
{
  vec4 fib = texture2D(uFiber, vPat * 0.19);
  vec4 fib2 = texture2D(uFiber, vPat * 0.047 + 0.37);
  float grain = texture2D(uFiber, vPat * 0.83 + 0.11).r;
  float hc = (vPat.x - uSlope * vPat.y) / uPitch;
  float f = fract(hc);
  float w = fwidth(hc) * 1.3 + 0.0012;
  float wob = (fib2.r - 0.5) * 0.008;
  float stripe = smoothstep(0.0, w, f + wob) * (1.0 - smoothstep(0.4, 0.4 + w, f + wob));
  // ink sits in the paper: slightly uneven, and it shows a little fainter on the inside of the wall
  vec3 col = mix(uPaper, uTint * (0.92 + 0.16 * grain), stripe * (vFace < 0.5 ? 0.84 : 0.97));
  // spiral construction seam, as on the real straws: a fine overlap line once per turn, with a soft lip
  float seam = 1.0 - smoothstep(0.0, 0.0025 + w, abs(f - 0.71));
  float lip = smoothstep(0.71, 0.71 + 0.02 + w, f) * (1.0 - smoothstep(0.73, 0.78, f));
  col *= 1.0 - 0.18 * seam - 0.04 * lip;
  if (vFace < 0.5) col *= vec3(1.0, 0.98, 0.945);
  col *= vShade * (0.9 + 0.2 * fib.r) * (0.93 + 0.14 * grain) * mix(vec3(1.0), vec3(1.0, 0.965, 0.9), clamp((fib2.g - 0.42) * 3.0, 0.0, 1.0));
  // exposed wall thickness (cut or torn): warm white/cream paper, with fibre breaking up what would
  // otherwise read as a flat, too-perfect tan - a cut edge stays a little cleaner on average than a
  // torn one, which gets its own whiter, more broken-up treatment just below via evRim
  if (vFace > 1.5) col = mix(vec3(0.96, 0.93, 0.85), vec3(0.8, 0.72, 0.57), smoothstep(0.2, 0.8, fib.r)) * (0.88 + 0.24 * grain);
  col *= 1.0 - 0.45 * evCrease;
  if (evRim > 0.5) col = mix(vec3(0.97, 0.95, 0.89), vec3(0.83, 0.76, 0.61), smoothstep(0.15, 0.85, fib.r)) * (0.9 + 0.22 * grain);
  // the pursuing front has its own look: a frayed, slightly scorched-kraft edge just ahead of where the wall lets go
  if (uCollapse > 0.5) col = mix(col, vec3(0.78, 0.6, 0.38) * (0.8 + 0.4 * grain), 0.55 * smoothstep(-1.4, 0.0, vD) * (1.0 - smoothstep(0.0, 2.5, vD)));
  // looking down a closed straw: the far end sinks into warm shade, which gives the tunnel depth
  if (uCirc > 0.0 && vFace < 0.5) col *= mix(vec3(1.0), vec3(0.74, 0.66, 0.58), smoothstep(7.0, 46.0, length(vViewPosition)));
  diffuseColor.rgb = col;
}
`;
// crumple and grain as real relief under the light (same idea as a bump map, from the paper height field)
const FRAG_BUMP = /* glsl */ `
if (uBump > 0.0) {
  float h0 = paperHeight(vPat);
  vec2 dH = vec2(dFdx(h0), dFdy(h0)) * uBump / max(0.35, length(vViewPosition) * 0.11);
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
}
`;
const FRAG_GLOW = /* glsl */ `
if (vFace < 0.5) totalEmissiveRadiance += diffuseColor.rgb * uGlow * (0.25 + 0.75 * max(dot(normalize(vOutW), uSunDir), 0.0));
`;
const FRAG_ROUGH = /* glsl */ `
roughnessFactor = clamp(0.84 + 0.4 * (texture2D(uFiber, vPat * 0.19).r - 0.5), 0.55, 1.0);
`;

export interface PaperParams { color: number; radius: number; pitch: number; slope: number; collapse: boolean; glow?: number; circ?: number; bump?: number }

export function createPaperMaterial(shared: PaperShared, p: PaperParams): MeshStandardMaterial {
  const own = {
    uSlope: { value: p.slope }, uPitch: { value: p.pitch }, uCollapse: { value: p.collapse ? 1 : 0 }, uRad: { value: p.radius },
    uBump: { value: p.bump ?? 0.9 }, uGlow: { value: p.glow ?? 0.36 }, uTint: { value: new Color(STRIPE_COLORS[p.color]) },
    uCirc: { value: p.circ ?? 0 },
  };
  const m = new MeshStandardMaterial({ roughness: 0.96, metalness: 0, side: FrontSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, own);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_DECL + '#include <common>').replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', FRAG_DECL + '#include <common>')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + DISCARD + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_BUMP)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_GLOW);
  };
  m.customProgramCacheKey = () => 'paper3';
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, own);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_DECL + '#include <common>').replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', 'uniform float uSlope, uPitch, uCollapse; varying vec2 vCoord; varying float vD;\nfloat ihash(vec2 p) { return 0.5; }\n' + EV_DECL + '#include <common>')
      .replace('void main() {', 'void main() {\n' + DISCARD);
  };
  depth.customProgramCacheKey = () => 'paperDepth3';
  m.userData.depth = depth;
  m.userData.own = own;
  return m;
}
