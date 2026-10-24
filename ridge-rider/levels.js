/* =========================================================
 * ridge-rider/levels.js — terrain data for Ridge Rider
 *
 * Each level is described with a small "track builder" so the shapes stay
 * readable; the builder turns it into plain terrain vertices that game.js
 * feeds to Matter.js as static bodies.
 *
 * Level format (what game.js reads):
 *   {
 *     id:        'hills',            // stable key (storage, analytics)
 *     name:      'Rolling Hills',    // shown in the HUD and level select
 *     desc:      'Smooth hills...',  // one-liner on the level select card
 *     terrain:   [ [[x, y], ...], ... ],  // one polyline per ground piece;
 *                                         // a new piece starts after every gap
 *     start:     { x, y },           // ground point the bike spawns above
 *     finishX:   7200,               // cross this X to finish
 *     timeLimit: 60                  // seconds
 *   }
 *
 * World units are pixels, y points DOWN (Matter / Phaser convention).
 * In the builder, heights are given "up" (positive = higher) to keep it intuitive.
 * Reference sizes: wheel radius 17, wheelbase 64, camera shows ~560 units tall.
 * ========================================================= */

const RR_LEVELS = (function () {
  'use strict';

  const BASE_Y = 600;   // y of height 0
  const STEP = 24;      // sample spacing for curves (smaller = smoother, more bodies)

  /* Smooth 0..1 ease with zero slope at both ends (used for hills and slopes) */
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  /**
   * Chainable track builder. Every method adds terrain to the right of the cursor.
   *   flat(len)                 straight, level ground
   *   slope(len, rise)          smooth S-curve up (rise > 0) or down (rise < 0)
   *   hills(count, len, amp)    rolling cosine bumps, each `len` wide and `amp` tall
   *   bumps(count, len, amp)    short sharp bumps (same as hills, meant for small len)
   *   kicker(len, rise)         jump ramp: gets steeper toward the lip
   *   gap(width, rise)          hole in the ground; next piece starts `rise` higher/lower
   */
  function track(startHeight) {
    const pieces = [[]];
    let x = 0;
    let h = startHeight || 0;
    const cur = () => pieces[pieces.length - 1];
    const push = (px, ph) => cur().push([Math.round(px), Math.round(BASE_Y - ph)]);
    push(x, h);

    // Sample f(t) (t in 0..1, returns height offset) over `len` units
    function curve(len, f) {
      const n = Math.max(1, Math.round(len / STEP));
      const x0 = x, h0 = h;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        push(x0 + len * t, h0 + f(t));
      }
      x = x0 + len;
      h = h0 + f(1);
    }

    const api = {
      flat(len) {
        x += len;
        push(x, h);
        return api;
      },
      slope(len, rise) {
        curve(len, (t) => rise * smooth(t));
        return api;
      },
      hills(count, len, amp) {
        for (let i = 0; i < count; i++) {
          curve(len, (t) => amp * (1 - Math.cos(t * Math.PI * 2)) / 2);
        }
        return api;
      },
      bumps(count, len, amp) {
        return api.hills(count, len, amp);
      },
      kicker(len, rise) {
        curve(len, (t) => rise * t * t);
        return api;
      },
      gap(width, rise) {
        x += width;
        h += rise || 0;
        pieces.push([]);
        push(x, h);
        return api;
      },
      // Returns the finished terrain plus the current cursor (handy for finishX)
      build() {
        return { terrain: pieces.filter((p) => p.length > 1), endX: x };
      }
    };
    return api;
  }

  /* ---------------- Level 1: Rolling Hills (tutorial) ----------------
   * Gentle hills only: learn throttle, braking and leaning. No gaps.
   * One small kicker near the end for a first taste of air. */
  const l1 = track(0)
    .flat(500)
    .hills(3, 520, 70)
    .flat(240)
    .slope(600, 140)
    .flat(200)
    .hills(2, 640, 110)
    .slope(700, -140)
    .flat(300)
    .hills(4, 420, 80)
    .flat(300)
    .kicker(260, 70)     // first little air
    .flat(10)
    .slope(500, -70)
    .flat(400)
    .hills(2, 800, 130)
    .flat(900)
    .build();

  /* ---------------- Level 2: Gap Jumps ----------------
   * Downhill run-ups into kickers over open gaps; land on the downslope.
   * Needs speed, and air control to land level. Falling in = crash. */
  const l2 = track(300)
    .flat(400)
    .slope(500, -120)
    .flat(120)
    .kicker(220, 60)
    .gap(160, -80)       // gap 1: small
    .slope(400, -80)
    .flat(300)
    .slope(500, -100)
    .flat(100)
    .kicker(240, 80)
    .gap(210, -100)      // gap 2: medium
    .slope(450, -100)
    .flat(250)
    .hills(1, 600, 90)
    .slope(600, -150)
    .flat(80)
    .kicker(280, 100)
    .gap(260, -140)      // gap 3: big
    .slope(500, -120)
    .flat(300)
    .slope(500, 160)
    .flat(150)
    .slope(500, -160)
    .kicker(260, 90)
    .gap(220, -110)      // gap 4: medium-big
    .slope(450, -60)
    .flat(1000)
    .build();

  /* ---------------- Level 3: Bumpy Ridge ----------------
   * Rough, choppy ground: full throttle bucks you off, so feather it and
   * keep the bike level with small leans. */
  const l3 = track(0)
    .flat(400)
    .bumps(6, 150, 18)
    .flat(150)
    .slope(500, 120)
    .bumps(6, 120, 22)
    .flat(120)
    .slope(500, -120)
    .bumps(8, 110, 24)
    .flat(200)
    .kicker(240, 70)
    .flat(10)
    .slope(400, -70)
    .bumps(5, 170, 28)
    .slope(500, 130)
    .bumps(6, 130, 22)
    .slope(500, -130)
    .bumps(8, 100, 20)
    .flat(900)
    .build();

  return [
    {
      id: 'hills',
      name: 'Rolling Hills',
      desc: 'Smooth hills to learn the ropes.',
      terrain: l1.terrain,
      start: { x: 160, y: BASE_Y },
      finishX: l1.endX - 500,
      timeLimit: 60
    },
    {
      id: 'gaps',
      name: 'Gap Jumps',
      desc: 'Hit the ramps fast and fly the gaps.',
      terrain: l2.terrain,
      start: { x: 160, y: BASE_Y - 300 },
      finishX: l2.endX - 500,
      timeLimit: 60
    },
    {
      id: 'bumps',
      name: 'Bumpy Ridge',
      desc: 'Choppy ground. Feather that throttle!',
      terrain: l3.terrain,
      start: { x: 160, y: BASE_Y },
      finishX: l3.endX - 500,
      timeLimit: 60
    }
  ];
})();
