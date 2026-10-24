/* =========================================================
 * ridge-rider/game.js — Ridge Rider (2D physics stunt bike)
 *
 * - Physics world, ridge terrain from levels.js, composite bike + rider,
 *   rear-wheel drive / brake / lean, smooth look-ahead camera
 * - Controls: Right / D (or hold the right half of the screen) = throttle + lean
 *   forward; Left / A (left half) = brake + lean back; release to coast
 * - Game states: ready -> riding -> crashed | finished | timeup, with a DOM HUD
 *   (level name, countdown, progress bar, score) and an end-of-run modal
 * - Tricks: full rotations in the air = Backflip / Frontflip; paid out only on a
 *   clean landing (both wheels, within LAND_TOLERANCE of the slope), else crash
 * - Levels from levels.js, progress + best scores in localStorage (STORE)
 * - Ads (shared/ads.js): rewarded revive (rewinds REVIVE_REWIND s) and +10s time
 *   extension, interstitial when leaving to the lobby from the end-of-run modal
 * - Polish: wheel dust, landing / crash bursts, speed zoom, engine + brake sound
 *   (Sound.motor), first-time tutorial, ground bodies streamed in / out of the
 *   physics world around the camera
 *
 * Dependencies (loaded in this order by index.html):
 *   Phaser 3 (CDN, ships with Matter.js) -> shared/analytics.js -> shared/ads.js
 *   -> shared/sound.js -> levels.js (RR_LEVELS) -> this file
 *
 * Units: world units are pixels at zoom 1, y points down. The camera zooms so the
 * view is always about VIEW_H world units tall, whatever the screen size.
 *
 * Debug: add ?debug=1 to the URL to see Matter.js collision outlines and a readout.
 * ========================================================= */

/* =========================================================
 * 1. Tuning knobs
 * ========================================================= */
const RR = {
  GRAVITY: 1,             // Matter gravity y (1 = default, ~1000 px/s^2 at 60 fps)
  MAX_DPR: 2,             // cap the canvas pixel ratio for performance
  VIEW_H: 560,            // world units visible vertically
  VIEW_W_MIN: 560,        // ...but never fewer than this horizontally (portrait phones)

  // Bike geometry (relative to the chassis centre, y down)
  WHEEL_R: 17,
  WHEEL_X: 32,            // half wheelbase
  WHEEL_Y: 20,            // axles sit this far below the chassis centre

  // Mass / contact
  WHEEL_DENSITY: 0.003,   // heavy wheels = low centre of mass = stable
  CHASSIS_DENSITY: 0.0015,
  WHEEL_FRICTION: 1,
  GROUND_FRICTION: 0.9,

  // Suspension: each axle is pinned to the frame by a short spring
  SUSPENSION_STIFFNESS: 0.35,
  SUSPENSION_DAMPING: 0,   // keep 0: Matter's constraint damping also kills flips
  SHOCK_DAMPING: 0.15,     // our own shock absorber (see Bike.dampSuspension), 0..1 per step

  // Drive (angular accelerations in rad/s^2; converted to Matter torque per body)
  DRIVE_ACCEL: 90,        // rear-wheel spin-up while holding throttle
  MAX_WHEEL_SPIN: 55,     // rad/s cap on rear wheel spin (~935 px/s top speed)
  TRACTION_SLIP: 120,     // traction control: on the ground the tyre surface may only run
                          // this many px/s faster than the bike (Matter friction slips a lot)
  BRAKE_FACTOR: 0.82,     // wheel spin multiplier per 1/60 s while braking
  LEAN_ACCEL_GROUND: 5,   // lean torque on the ground (small: Right is also the throttle)
  LEAN_ACCEL_AIR: 22,     // lean torque in the air (flips)
  MAX_LEAN_SPIN: 7.5,     // rad/s cap: lean torque stops pushing past this

  // Camera
  CAM_LERP: 0.08,         // 0..1 per frame, higher = snappier
  CAM_LOOK_AHEAD: 0.45,   // seconds of horizontal velocity to look ahead
  CAM_LOOK_MAX: 220,      // max look-ahead in world units (and never over 1/4 of the view width)
  CAM_OFFSET_Y: -40,      // keep the bike slightly below centre (see more sky ahead)

  // Terrain bodies
  GROUND_THICKNESS: 80,   // depth of each ground slice under the surface

  // Crash rules
  TIP_ANGLE: 110,         // degrees from upright that count as "upside down"...
  TIP_TIME: 0.5,          // ...for this long (seconds) while not flying = crash
  STUCK_ANGLE: 70,        // standing on its nose / tail past this angle...
  STUCK_SPEED: 40,        // ...while slower than this (px/s)...
  STUCK_TIME: 1.0,        // ...for this long = crash
  CRASH_MODAL_DELAY: 700, // ms: let the crash play out for a moment before freezing
  FALL_DEPTH: 450,        // falling this far below the lowest ground (into a gap) = crash

  // Tricks
  AIR_STEPS: 8,           // physics steps with nothing touching before we call it "airborne"
  FLIP_DEG: 330,          // rotation that counts as the first full flip (a little forgiving:
                          // ramps tilt you before take-off); each further flip needs +360
  FLIP_POINTS: 50,        // points per flip, paid out on a clean landing
  LAND_TOLERANCE: 30,     // a trick landing must be within this many degrees of the slope...
  LAND_WINDOW: 0.6,       // ...with both wheels down within this many seconds of touchdown
  TIME_BONUS: 10,         // points per second left on the clock at the finish

  // Rewarded ads
  MAX_REVIVES: 2,         // "Watch Ad to Revive" uses per level run
  REVIVE_REWIND: 2,       // seconds to rewind the bike on revive
  MAX_TIME_EXT: 1,        // "Watch Ad for +10s" uses per level run
  TIME_EXT_SECONDS: 10,
  TIME_EXT_BELOW: 10,     // offer the time extension when fewer seconds than this are left

  // Effects
  ZOOM_OUT_AT_SPEED: 0.14, // zoom out up to 14% at full speed...
  ZOOM_FULL_SPEED: 900,    // ...reached at this speed (px/s)
  DUST_MIN_SPEED: 90,      // wheels kick up dust above this speed (px/s)
  STREAM_MARGIN: 1500      // ground bodies further than this outside the view leave the world
};

/* localStorage keys */
const STORE = {
  LEVEL: 'ridge_level',       // index of the level to open next time
  UNLOCKED: 'ridge_unlocked', // highest unlocked level index
  BEST: 'ridge_best_',        // + level id: best score
  TUTORIAL: 'ridge_tutorial_seen'
};
function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : +v;
  } catch (e) {
    return fallback; // private mode etc.
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) { /* ignore */ }
}

const DEBUG = /[?&]debug=1/.test(location.search);
const M = Phaser.Physics.Matter.Matter; // the Matter.js module bundled with Phaser
const DPR = Math.min(window.devicePixelRatio || 1, RR.MAX_DPR);
const appEl = document.getElementById('app');

/* Converts an angular acceleration (rad/s^2) into the torque Matter needs.
 * Matter integrates angularVelocity (rad per step) += torque / inertia * dt_ms^2,
 * so torque = alpha * inertia / 1e6 makes the result frame-rate independent. */
function torqueFor(alpha, inertia) {
  return alpha * inertia / 1e6;
}

/* =========================================================
 * 2. Bike: a chassis compound (frame + rider torso + head) and two wheels,
 *    each wheel pinned to the chassis by a sprung constraint.
 * ========================================================= */
class Bike {
  constructor(scene, x, y) {
    this.scene = scene;
    const world = scene.matter.world;
    const group = M.Body.nextGroup(true); // bike parts never collide with each other

    // Chassis parts (absolute positions at creation time)
    const frame = M.Bodies.rectangle(x, y, 70, 10, { label: 'frame' });
    const torso = M.Bodies.rectangle(x - 4, y - 24, 12, 32, { label: 'torso' });
    const head = M.Bodies.circle(x + 2, y - 47, 9, { label: 'head' });
    this.chassis = M.Body.create({
      parts: [frame, torso, head],
      label: 'chassis',
      collisionFilter: { group },
      frictionAir: 0.005
    });
    M.Body.setDensity(this.chassis, RR.CHASSIS_DENSITY);
    this.head = head;

    const wheelOpts = {
      label: 'wheel',
      collisionFilter: { group },
      friction: RR.WHEEL_FRICTION,
      frictionStatic: 4,
      restitution: 0.05,
      density: RR.WHEEL_DENSITY,
      frictionAir: 0.002
    };
    // Matter's Bodies.circle uses only ~radius sides (17 here), which makes a spinning
    // wheel hop on its corners and lose grip; a 40-sided polygon rolls smoothly.
    this.rear = M.Bodies.polygon(x - RR.WHEEL_X, y + RR.WHEEL_Y, 40, RR.WHEEL_R, wheelOpts);
    this.front = M.Bodies.polygon(x + RR.WHEEL_X, y + RR.WHEEL_Y, 40, RR.WHEEL_R, wheelOpts);
    this.rear.label = 'rearWheel';
    this.front.label = 'frontWheel';

    world.add([this.chassis, this.rear, this.front]);

    // Axle springs: chassis offset (pointA, relative to the chassis centre of mass)
    // to wheel centre. Compound bodies re-centre on their centre of mass, so measure
    // the offset from the actual chassis position rather than from (x, y).
    const cx = this.chassis.position.x, cy = this.chassis.position.y;
    const axle = (wheel) => M.Constraint.create({
      bodyA: this.chassis,
      pointA: { x: wheel.position.x - cx, y: wheel.position.y - cy },
      bodyB: wheel,
      length: 0,
      stiffness: RR.SUSPENSION_STIFFNESS,
      damping: RR.SUSPENSION_DAMPING
    });
    this.constraints = [axle(this.rear), axle(this.front)];
    world.add(this.constraints);
    // Mount offsets at angle 0 (Matter rotates pointA in place as the bike turns)
    this.mounts = this.constraints.map((k) => ({ x: k.pointA.x, y: k.pointA.y }));

    // Matter velocities are "per step", and Phaser runs one step per rendered frame,
    // so convert with the real step length (set by the scene before every step)
    this.perSec = 60;

    // Ground contact: the physics step on which each part last touched the ground
    // (set from collision events in the scene; robust against missed "end" events)
    this.step = 0;
    // ('chassis' = any of frame / torso / head)
    this.touched = { rearWheel: -9, frontWheel: -9, chassis: -9 };
  }

  get bodies() {
    return [this.chassis, this.rear, this.front];
  }

  // True if `label` touched the ground within the last `steps` physics steps
  touching(label, steps) {
    return this.step - this.touched[label] <= (steps || 1);
  }

  get onGround() {
    return this.touching('rearWheel') || this.touching('frontWheel');
  }

  /**
   * Applies controls for one physics step.
   * @param {number} throttle 1 = accelerate / lean forward, 0 = coast
   * @param {number} brake    1 = brake / lean back, 0 = coast
   */
  drive(throttle, brake) {
    const rear = this.rear;
    const c = this.chassis;
    const spin = rear.angularVelocity * this.perSec; // rad/step -> rad/s

    // Traction control: never let the rear tyre run much faster than the bike moves
    // along its own axis (also in the air, so it doesn't land at full spin and skid)
    const along = (c.velocity.x * Math.cos(c.angle) + c.velocity.y * Math.sin(c.angle)) * this.perSec;
    const maxSpin = Math.min(RR.MAX_WHEEL_SPIN, (Math.max(0, along) + RR.TRACTION_SLIP) / RR.WHEEL_R);

    // Rear-wheel drive: clockwise spin (positive in screen space) moves the bike right
    if (throttle && spin < maxSpin) {
      rear.torque += torqueFor(RR.DRIVE_ACCEL, rear.inertia);
    }

    // Brake: bleed spin off both wheels
    if (brake) {
      const k = Math.pow(RR.BRAKE_FACTOR, 60 / this.perSec); // same braking at any frame rate
      [this.rear, this.front].forEach((w) => {
        M.Body.setAngularVelocity(w, w.angularVelocity * k);
      });
    }

    // Lean (centre-of-mass control): forward = clockwise, back = counter-clockwise
    const lean = (throttle ? 1 : 0) - (brake ? 1 : 0);
    if (lean) {
      const alpha = this.onGround ? RR.LEAN_ACCEL_GROUND : RR.LEAN_ACCEL_AIR;
      const leanSpin = this.chassis.angularVelocity * this.perSec;
      if (lean * leanSpin < RR.MAX_LEAN_SPIN) this.rotate(lean * alpha);
    }
  }

  /* Shock absorbers. Matter's own constraint damping on these zero-length springs
   * also brakes any rotation of the whole bike (flips died within ~0.2 s), so the
   * springs run undamped and this damps each wheel's motion relative to its mount
   * point instead. In a rigid spin that relative motion is zero, so flips keep going. */
  dampSuspension() {
    const c = this.chassis;
    const w = c.angularVelocity;
    this.constraints.forEach((k) => {
      const wheel = k.bodyB;
      const rx = k.pointA.x, ry = k.pointA.y; // mount offset (Matter keeps it rotated)
      // Velocity of the mount point = chassis velocity + w x r
      const mvx = c.velocity.x - w * ry, mvy = c.velocity.y + w * rx;
      const dvx = (wheel.velocity.x - mvx) * RR.SHOCK_DAMPING;
      const dvy = (wheel.velocity.y - mvy) * RR.SHOCK_DAMPING;
      // Split the correction by mass so momentum is conserved
      const total = wheel.mass + c.mass;
      M.Body.setVelocity(wheel, {
        x: wheel.velocity.x - dvx * c.mass / total,
        y: wheel.velocity.y - dvy * c.mass / total
      });
      M.Body.setVelocity(c, {
        x: c.velocity.x + dvx * wheel.mass / total,
        y: c.velocity.y + dvy * wheel.mass / total
      });
    });
  }

  /* Spins the whole bike (frame + both wheels) as one rigid piece around its shared
   * centre of mass with angular acceleration `alpha` (rad/s^2, clockwise positive).
   * Torquing only the frame doesn't work: the soft axle springs soak most of it up
   * (the bike topped out at ~2 rad/s), so each wheel also gets the tangential force
   * it needs to orbit along. The forces cancel out, so leaning never pushes the bike. */
  rotate(alpha) {
    const parts = this.bodies;
    let m = 0, cx = 0, cy = 0;
    parts.forEach((b) => { m += b.mass; cx += b.position.x * b.mass; cy += b.position.y * b.mass; });
    cx /= m; cy /= m;
    parts.forEach((b) => {
      const rx = b.position.x - cx, ry = b.position.y - cy;
      // a = alpha x r (screen coords, y down); Matter force = mass * a / 1e6 (see torqueFor)
      M.Body.applyForce(b, b.position, { x: -alpha * ry * b.mass / 1e6, y: alpha * rx * b.mass / 1e6 });
    });
    this.chassis.torque += torqueFor(alpha, this.chassis.inertia);
  }

  /* Instantly moves the whole bike (used by restarts / revive later) */
  /* x, y = chassis centre of mass; wheels go exactly on their mounts (no spring kick) */
  place(x, y, angle) {
    const c = this.chassis;
    const a = angle || 0;
    const cos = Math.cos(a), sin = Math.sin(a);
    M.Body.setAngle(c, a);
    M.Body.setPosition(c, { x, y });
    this.constraints.forEach((k, i) => {
      const m = this.mounts[i];
      k.pointA.x = m.x * cos - m.y * sin;
      k.pointA.y = m.x * sin + m.y * cos;
      k.angleA = a; // tell Matter pointA already matches this angle
      M.Body.setPosition(k.bodyB, { x: x + k.pointA.x, y: y + k.pointA.y });
    });
    this.bodies.forEach((b) => {
      M.Body.setVelocity(b, { x: 0, y: 0 });
      M.Body.setAngularVelocity(b, 0);
    });
  }

  /* Draws the bike + rider with simple shapes (called every frame) */
  draw(g) {
    const c = this.chassis;
    const a = c.angle;
    const cos = Math.cos(a), sin = Math.sin(a);
    // Local (chassis space) -> world
    const P = (lx, ly) => ({
      x: c.position.x + lx * cos - ly * sin,
      y: c.position.y + lx * sin + ly * cos
    });
    // The chassis centre of mass is not the frame centre; get the frame centre
    // from its part so the drawing lines up with the physics shapes.
    const frame = c.parts.find((p) => p.label === 'frame');
    const fx = frame.position.x - c.position.x, fy = frame.position.y - c.position.y;
    const lfx = fx * cos + fy * sin, lfy = -fx * sin + fy * cos; // frame centre in local space
    const L = (lx, ly) => P(lfx + lx, lfy + ly);

    g.clear();

    // Wheels: tyre, rim, and two spokes so spin is visible
    [this.rear, this.front].forEach((w) => {
      const { x, y } = w.position;
      g.fillStyle(0x2b2f36, 1).fillCircle(x, y, RR.WHEEL_R);
      g.fillStyle(0xdfe4ea, 1).fillCircle(x, y, RR.WHEEL_R - 5);
      g.lineStyle(2, 0x2b2f36, 1);
      for (let k = 0; k < 2; k++) {
        const s = w.angle + k * Math.PI / 2;
        const dx = Math.cos(s) * (RR.WHEEL_R - 5), dy = Math.sin(s) * (RR.WHEEL_R - 5);
        g.lineBetween(x - dx, y - dy, x + dx, y + dy);
      }
      g.fillStyle(0x2b2f36, 1).fillCircle(x, y, 3);
    });

    // Forks / swingarm from frame to axles
    const rearAxle = this.rear.position, frontAxle = this.front.position;
    const rearMount = L(-22, 2), frontMount = L(26, -6);
    g.lineStyle(5, 0x50555e, 1);
    g.lineBetween(rearMount.x, rearMount.y, rearAxle.x, rearAxle.y);
    g.lineBetween(frontMount.x, frontMount.y, frontAxle.x, frontAxle.y);

    // Frame (filled rotated quad)
    const quad = (pts, color) => {
      g.fillStyle(color, 1);
      g.fillPoints(pts.map((p) => L(p[0], p[1])), true);
    };
    quad([[-35, -5], [35, -5], [35, 5], [-35, 5]], 0xff7f50);   // body
    quad([[-30, -9], [6, -9], [6, -4], [-30, -4]], 0x2d3436);   // seat
    quad([[22, -14], [34, -14], [34, -6], [22, -6]], 0xe8613a); // headlight cowl

    // Rider: legs, torso, arms, head with helmet
    const hip = L(-6, -10), knee = L(10, -4), foot = L(4, 4);
    const shoulder = L(-2, -38), hand = L(26, -18);
    g.lineStyle(7, 0x34495e, 1);
    g.lineBetween(hip.x, hip.y, knee.x, knee.y);
    g.lineBetween(knee.x, knee.y, foot.x, foot.y);
    g.lineStyle(10, 0x4d7cfe, 1);
    g.lineBetween(hip.x, hip.y, shoulder.x, shoulder.y);
    g.lineStyle(5, 0x4d7cfe, 1);
    g.lineBetween(shoulder.x, shoulder.y, hand.x, hand.y);
    const headPos = this.head.position;
    g.fillStyle(0xffd23f, 1).fillCircle(headPos.x, headPos.y, 10);         // helmet
    const visor = P(lfx + 11, lfy - 48);
    g.fillStyle(0x2d3436, 1).fillCircle(visor.x, visor.y, 3.5);
  }
}

/* =========================================================
 * 3. HUD + modal (plain DOM, laid over the canvas)
 * ========================================================= */
const ui = {
  levelName: document.getElementById('level-name'),
  score: document.getElementById('score'),
  trickPop: document.getElementById('trick-pop'),
  stats: document.getElementById('modal-stats'),
  btnNext: document.getElementById('btn-next'),
  btnRevive: document.getElementById('btn-revive'),
  btnTime: document.getElementById('btn-time'),
  padGas: document.getElementById('pad-gas'),
  padBrake: document.getElementById('pad-brake'),
  timer: document.getElementById('timer'),
  progressFill: document.getElementById('progress-fill'),
  progressBike: document.getElementById('progress-bike'),
  readyTip: document.getElementById('ready-tip'),
  mute: document.getElementById('btn-mute'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  modalText: document.getElementById('modal-text'),
  btnRetry: document.getElementById('btn-retry'),
  shownTime: null,

  reset(level, index) {
    this.levelName.textContent = (index + 1) + '. ' + level.name;
    this.setScore(0);
    this.shownTime = null;
    this.setTime(level.timeLimit);
    this.setProgress(0);
    this.readyTip.classList.remove('hidden');
    this.modal.classList.add('hidden');
  },

  setTime(seconds) {
    const t = Math.max(0, Math.ceil(seconds));
    if (t === this.shownTime) return; // only touch the DOM when the number changes
    this.shownTime = t;
    this.timer.textContent = t;
    this.timer.classList.toggle('low', t <= 10);
  },

  setProgress(p) {
    const pct = (Phaser.Math.Clamp(p, 0, 1) * 100).toFixed(1) + '%';
    this.progressFill.style.width = pct;
    this.progressBike.style.left = pct;
  },

  setScore(n) {
    this.score.textContent = n;
  },

  /* Big centred trick text, e.g. "Backflip! +50" (restarts the CSS animation) */
  pop(text, kind) {
    const el = this.trickPop;
    el.textContent = text;
    el.className = '';
    void el.offsetWidth; // force reflow so the animation plays again
    el.className = 'show ' + (kind || '');
  },

  /**
   * @param {string} title
   * @param {string} text
   * @param {object} [opts] stats: [[label, value], ...] rows; next: label for the
   *                        "Next Level" button (omit to hide it); revives: revives
   *                        left (shows "Watch Ad to Revive" when > 0)
   */
  showModal(title, text, opts) {
    opts = opts || {};
    this.modalTitle.textContent = title;
    this.modalText.textContent = text;
    this.stats.innerHTML = '';
    (opts.stats || []).forEach(([label, value]) => {
      const row = document.createElement('div');
      row.innerHTML = '<span></span><b></b>';
      row.firstChild.textContent = label;
      row.lastChild.textContent = value;
      this.stats.appendChild(row);
    });
    this.stats.classList.toggle('hidden', !opts.stats);
    this.btnNext.classList.toggle('hidden', !opts.next);
    if (opts.next) this.btnNext.textContent = opts.next;
    const revive = opts.revives > 0;
    this.btnRevive.classList.toggle('hidden', !revive);
    if (revive) this.btnRevive.textContent = '▶ Watch Ad to Revive (' + opts.revives + ' left)';
    // "Next Level" / revive is the main action when shown; Retry then steps down
    // (with ads off the revive button is hidden by ads.js, so Retry stays primary)
    this.btnRetry.textContent = opts.next ? 'Retry' : 'Try Again';
    this.btnRetry.classList.toggle('secondary', !!opts.next || (revive && adsEnabled()));
    this.setTimeOffer(false);
    this.modal.classList.remove('hidden');
  },

  setTimeOffer(show) {
    this.btnTime.classList.toggle('hidden', !show);
  },

  // Light up the on-screen pads (touch devices) while held
  setPads(throttle, brake) {
    this.padGas.classList.toggle('active', !!throttle);
    this.padBrake.classList.toggle('active', !!brake);
  }
};

ui.mute.textContent = Sound.isMuted() ? '🔇' : '🔊';
ui.mute.addEventListener('click', () => {
  ui.mute.textContent = Sound.toggle() ? '🔇' : '🔊';
});
ui.btnRetry.addEventListener('click', () => scene().retry());
ui.btnNext.addEventListener('click', () => scene().nextLevel());
ui.btnRevive.addEventListener('click', () => scene().watchRevive());
ui.btnTime.addEventListener('click', () => scene().watchTimeExtension());
// Leaving for the lobby from the end-of-run modal: interstitial first
// (ads.js applies the frequency cap and calls back straight away when skipped)
document.getElementById('btn-lobby').addEventListener('click', (e) => {
  e.preventDefault();
  const href = e.currentTarget.href;
  showInterstitial(() => { location.href = href; });
});
// Keyboard players: Enter / Space on the modal = the main button
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !ui.modal.classList.contains('hidden')) {
    e.preventDefault();
    if (ui.btnNext.classList.contains('hidden')) scene().retry();
    else scene().nextLevel();
  }
});

/* ---------------- First-time tutorial ---------------- */
const tutorial = {
  el: document.getElementById('tutorial'),
  get open() {
    return !this.el.classList.contains('hidden');
  },
  maybeShow() {
    if (!load(STORE.TUTORIAL, 0)) this.el.classList.remove('hidden');
  },
  close() {
    save(STORE.TUTORIAL, 1);
    this.el.classList.add('hidden');
  }
};
document.getElementById('btn-tutorial').addEventListener('click', () => tutorial.close());
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && tutorial.open) {
    e.preventDefault();
    tutorial.close();
  }
});

/* ---------------- Level select ----------------
 * Opens on page load, from the level name in the HUD, and from the end-of-run
 * modal. The scene is paused while it's open; picking a level restarts it. */
const levelSelect = {
  el: document.getElementById('levels'),
  list: document.getElementById('level-list'),
  btnClose: document.getElementById('btn-levels-close'),
  open: false,

  show(canClose) {
    this.open = true;
    this.render();
    this.btnClose.classList.toggle('hidden', !canClose);
    this.el.classList.remove('hidden');
    const sc = scene();
    if (sc && sc.sys.isActive()) sc.scene.pause();
  },

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
    const sc = scene();
    if (sc && sc.sys.isPaused()) sc.scene.resume();
  },

  pick(index) {
    this.hide();
    ui.modal.classList.add('hidden');
    scene().scene.restart({ level: index });
  },

  render() {
    const unlocked = load(STORE.UNLOCKED, 0);
    const sc = scene();
    const current = sc && sc.level ? sc.levelIndex : load(STORE.LEVEL, 0);
    this.list.innerHTML = '';
    RR_LEVELS.forEach((level, i) => {
      const locked = i > unlocked;
      const best = load(STORE.BEST + level.id, 0);
      const card = document.createElement('button');
      card.className = 'level-card' + (locked ? ' locked' : '') + (i === current ? ' current' : '');
      card.disabled = locked;
      card.innerHTML =
        terrainSvg(level) +
        '<div class="info"><b></b><span class="desc"></span><span class="meta"></span></div>';
      card.querySelector('b').textContent = (i + 1) + '. ' + level.name;
      card.querySelector('.desc').textContent = level.desc;
      card.querySelector('.meta').textContent = locked
        ? '🔒 Finish ' + RR_LEVELS[i - 1].name + ' to unlock'
        : best ? '🏆 Best: ' + best : 'Not finished yet';
      if (!locked) card.addEventListener('click', () => this.pick(i));
      this.list.appendChild(card);
    });
  }
};

/* Tiny side-view silhouette of a level's terrain (inline SVG, no images) */
function terrainSvg(level) {
  const pts = level.terrain.flat();
  const minX = pts[0][0], maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const W = 120, H = 44, pad = 6;
  const sx = W / (maxX - minX);
  // Exaggerate height so hills are visible, but not so much they turn into spikes
  const sy = Math.min((H - pad * 2) / Math.max(1, maxY - minY), sx * 5);
  const paths = level.terrain.map((piece) => {
    const line = piece
      .filter((p, i) => i % 3 === 0 || i === piece.length - 1) // fewer points is plenty
      .map(([x, y]) => ((x - minX) * sx).toFixed(1) + ',' + (H - pad - (maxY - y) * sy).toFixed(1));
    const x0 = ((piece[0][0] - minX) * sx).toFixed(1);
    const x1 = ((piece[piece.length - 1][0] - minX) * sx).toFixed(1);
    return '<path d="M' + x0 + ',' + H + ' L' + line.join(' L') + ' L' + x1 + ',' + H + ' Z"/>';
  }).join('');
  return '<svg class="thumb" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + paths + '</svg>';
}

ui.levelName.addEventListener('click', () => levelSelect.show(true));
document.getElementById('btn-levels').addEventListener('click', () => levelSelect.show(true));
levelSelect.btnClose.addEventListener('click', () => levelSelect.hide());

/* =========================================================
 * 4. Main scene
 * ========================================================= */
class RideScene extends Phaser.Scene {
  constructor() {
    super('ride');
  }

  init(data) {
    // Explicit level (retry / next), else where the player left off
    const unlocked = Math.min(load(STORE.UNLOCKED, 0), RR_LEVELS.length - 1);
    const wanted = data && data.level != null ? data.level : load(STORE.LEVEL, 0);
    this.levelIndex = Phaser.Math.Clamp(wanted, 0, unlocked);
    save(STORE.LEVEL, this.levelIndex);
  }

  create() {
    this.level = RR_LEVELS[this.levelIndex];
    this.state = 'ready';       // ready -> riding -> crashed | finished | timeup
    this.timeLeft = this.level.timeLimit;
    this.rideTime = 0;          // seconds spent riding (for stats)
    this.tipTime = 0;           // seconds spent upside down on the ground
    this.stuckTime = 0;         // seconds spent stuck on the nose / tail
    this.score = 0;             // trick points banked this run
    this.tricks = 0;            // flips landed this run
    this.air = null;            // { start, flips, dir } while airborne
    this.landing = null;        // { t, flips, dir } while judging a trick landing
    this.started = false;       // first input happened (analytics: one game_start per run)
    this.revivesLeft = RR.MAX_REVIVES;
    this.timeExtLeft = RR.MAX_TIME_EXT;
    this.history = [];          // recent safe bike poses for revive: { t, x, y, angle }
    this.lastSnap = -1;
    this.maxGroundY = Math.max(...this.level.terrain.flat().map((p) => p[1]));

    this.buildTerrain(this.level);
    this.drawFinish(this.level.finishX);

    const s = this.level.start;
    this.bike = new Bike(this, s.x, s.y - 60);
    this.bikeGfx = this.add.graphics().setDepth(5);
    this.createParticles();
    this.startX = this.bike.chassis.position.x;

    this.setupContacts();
    this.setupInput();

    // Apply controls right before every physics step (frame-rate independent)
    this.matter.world.on('beforeupdate', () => {
      this.bike.step++;
      this.bike.perSec = 1000 / (this.matter.world.engine.timing.lastDelta || 1000 / 60);
      const live = this.state === 'ready' || this.state === 'riding';
      this.bike.drive(live && this.ctrl.throttle, live && this.ctrl.brake);
      this.bike.dampSuspension();
    });

    // Camera: start on the bike, then follow smoothly in update()
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    this.fitCamera();
    this.camPos = { x: this.bike.chassis.position.x, y: this.bike.chassis.position.y + RR.CAM_OFFSET_Y };
    this.cameras.main.centerOn(this.camPos.x, this.camPos.y);
    const onResize = () => this.fitCamera();
    this.scale.on('resize', onResize);
    // Paused by the level select / a time-extension ad: the update loop stops, so
    // the engine would hold its last note without this
    const onPause = () => Sound.motor.silence();
    this.events.on('pause', onPause);
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      this.events.off('pause', onPause); // scene events outlive restarts
      Sound.motor.silence();
    });
    this.streamTimer = 0;
    this.updateStreaming();

    if (DEBUG && !this.debugText) {
      // DOM overlay (a Phaser text with scrollFactor 0 would still be moved by camera zoom)
      this.debugText = document.createElement('pre');
      this.debugText.style.cssText = 'position:absolute;left:8px;top:96px;z-index:20;margin:0;padding:4px 6px;' +
        'font:12px/1.4 monospace;background:rgba(255,255,255,0.75);pointer-events:none';
      appEl.appendChild(this.debugText);
    }

    ui.reset(this.level, this.levelIndex);
    document.getElementById('loading').classList.add('done');
    if (levelSelect.open) this.scene.pause(); // first load: wait behind the level select
    else tutorial.maybeShow();
  }

  /* Each terrain polyline becomes a row of convex static slices
   * (surface segment on top, flat bottom), plus one filled shape for drawing. */
  buildTerrain(level) {
    this.ground = [];
    const g = this.add.graphics().setDepth(1);
    const T = RR.GROUND_THICKNESS;

    // Behind the start: a steep bank so rolling backwards just rolls you back down
    const [sx, sy] = level.terrain[0][0];
    const bank = [];
    for (let i = 12; i > 0; i--) {
      const t = i / 12;
      bank.push([sx - 420 * t, sy - 320 * t * t]);
    }
    const pieces = level.terrain.map((pts, i) => (i === 0 ? bank.concat(pts) : pts));

    pieces.forEach((pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        const bottom = Math.max(y1, y2) + T;
        const verts = [{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x2, y: bottom }, { x: x1, y: bottom }];
        const centre = M.Vertices.centre(verts);
        const body = M.Bodies.fromVertices(centre.x, centre.y, [verts], {
          isStatic: true,
          label: 'ground',
          friction: RR.GROUND_FRICTION,
          frictionStatic: 4
        });
        body.spanX = [x1, x2]; // for streaming (see updateStreaming)
        this.ground.push(body);
      }

      // Visual: dirt body down to well below the screen, grass edge on top
      const deep = Math.max(...pts.map((p) => p[1])) + 1200;
      const poly = pts.map(([x, y]) => ({ x, y }));
      poly.push({ x: pts[pts.length - 1][0], y: deep }, { x: pts[0][0], y: deep });
      g.fillStyle(0x8a5a3b, 1).fillPoints(poly, true);
      g.lineStyle(14, 0x6dbb4f, 1).strokePoints(pts.map(([x, y]) => ({ x, y: y + 5 })), false);
      g.lineStyle(4, 0x8fd16a, 1).strokePoints(pts.map(([x, y]) => ({ x, y: y - 1 })), false);
    });

    // Invisible wall on top of the bank, just in case someone flies up it
    this.ground.push(M.Bodies.rectangle(sx - 440, sy - 1000, 40, 1400, { isStatic: true, label: 'ground' }));

    // Bodies are added by updateStreaming() as the camera gets near them
    this.ground.forEach((b) => { b.inWorld = false; });
  }

  /* Only ground slices near the camera live in the physics world: far-away ones
   * are removed (and re-added when you come back, e.g. after a revive), so the
   * broad phase stays small however long the level is. */
  updateStreaming() {
    const view = this.cameras.main.worldView;
    const cx = this.bike.chassis.position.x;
    const left = Math.min(view.x, cx) - RR.STREAM_MARGIN;
    const right = Math.max(view.right, cx) + RR.STREAM_MARGIN;
    const world = this.matter.world.localWorld;
    for (const b of this.ground) {
      const near = !b.spanX || (b.spanX[1] >= left && b.spanX[0] <= right); // the wall always stays
      if (near && !b.inWorld) M.Composite.add(world, b);
      else if (!near && b.inWorld) M.Composite.remove(world, b);
      b.inWorld = near;
    }
  }

  /* Dust puffs (one shared white-circle texture, tinted) */
  createParticles() {
    if (!this.textures.exists('dust')) {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xffffff, 1).fillCircle(8, 8, 8);
      g.generateTexture('dust', 16, 16);
      g.destroy();
    }
    const tint = [0xcaa57c, 0xb48a62, 0xd9c09a];
    this.dust = this.add.particles(0, 0, 'dust', {
      emitting: false,
      lifespan: { min: 350, max: 650 },
      speed: { min: 15, max: 70 },
      angle: { min: 195, max: 300 },   // up and back (the bike rides right)
      scale: { start: 0.5, end: 1.5 },
      alpha: { start: 0.65, end: 0 },
      gravityY: -30,
      tint
    }).setDepth(4);
    this.burst = this.add.particles(0, 0, 'dust', {
      emitting: false,
      lifespan: { min: 450, max: 800 },
      speed: { min: 60, max: 220 },
      angle: { min: 180, max: 360 },
      scale: { start: 0.5, end: 1.6 },
      alpha: { start: 0.7, end: 0 },
      gravityY: 120,
      tint
    }).setDepth(6);
  }

  /* Dust from each wheel on the ground, more with speed / wheelspin */
  emitDust() {
    const b = this.bike, c = b.chassis;
    const speed = Math.hypot(c.velocity.x, c.velocity.y) * b.perSec;
    if (speed < RR.DUST_MIN_SPEED) return;
    const chance = Math.min(1, speed / 700);
    [b.rear, b.front].forEach((w) => {
      if (!b.touching(w.label, 2)) return;
      let n = Math.random() < chance ? 1 : 0;
      if (w === b.rear && this.ctrl.throttle) n++;
      if (n) this.dust.emitParticleAt(w.position.x, w.position.y + RR.WHEEL_R * 0.85, n);
    });
  }

  /* Landing after real air: dust burst under both wheels, thud, little shake */
  landingFx(impact) {
    const v = Phaser.Math.Clamp(impact / 900, 0.15, 1); // impact = vertical speed px/s
    [this.bike.rear, this.bike.front].forEach((w) => {
      this.burst.emitParticleAt(w.position.x, w.position.y + RR.WHEEL_R * 0.8, Math.round(4 + 10 * v));
    });
    Sound.play('land', { v });
    if (v > 0.5) this.cameras.main.shake(140, 0.004 * v);
  }

  /* Checkered finish banner */
  drawFinish(x) {
    const y = this.groundYAt(x);
    const g = this.add.graphics().setDepth(2);
    g.fillStyle(0x50555e, 1).fillRect(x - 3, y - 150, 6, 150);
    const size = 12;
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 6; col++) {
        g.fillStyle((r + col) % 2 ? 0x2d3436 : 0xffffff, 1)
          .fillRect(x + 3 + col * size, y - 150 + r * size, size, size);
      }
    }
  }

  /* Slope angle (radians, Matter convention) of the ground at x; 0 over a gap */
  groundAngleAt(x) {
    for (const pts of this.level.terrain) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        if (x >= x1 && x <= x2) return Math.atan2(y2 - y1, x2 - x1);
      }
    }
    return 0;
  }

  /* Ground height at x (top surface), or null over a gap */
  groundYAt(x) {
    for (const pts of this.level.terrain) {
      if (x < pts[0][0] || x > pts[pts.length - 1][0]) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        if (x >= x1 && x <= x2) return y1 + (y2 - y1) * ((x - x1) / (x2 - x1 || 1));
      }
    }
    return null;
  }

  /* Track which wheels / rider parts touch the ground; the head touching it = crash.
   * Matter reports compound bodies by part, so we see 'head' / 'torso' / 'frame'. */
  setupContacts() {
    const mark = (e) => {
      const bike = this.bike;
      for (const pair of e.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        const other = a.label === 'ground' ? b : b.label === 'ground' ? a : null;
        if (!other) continue;
        if (other.label in bike.touched) bike.touched[other.label] = bike.step;
        else if (other.parent === bike.chassis) bike.touched.chassis = bike.step;
        if (other.label === 'head') this.crash('head');
      }
    };
    this.matter.world.on('collisionstart', mark);
    this.matter.world.on('collisionactive', mark);
  }

  /* Keyboard (arrows or A / D) and touch / mouse (hold left or right half) */
  setupInput() {
    this.ctrl = { throttle: 0, brake: 0 };
    this.keys = this.input.keyboard.addKeys('LEFT,RIGHT,A,D');
    this.input.addPointer(2); // up to 3 simultaneous touches
    this.input.keyboard.on('keydown-R', () => this.retry()); // quick restart
  }

  readControls() {
    if (tutorial.open) {
      this.ctrl.throttle = this.ctrl.brake = 0;
      return;
    }
    const f = this.forceCtrl; // test hook: { throttle, brake } overrides real input
    if (f) {
      this.ctrl.throttle = f.throttle;
      this.ctrl.brake = f.brake;
      return;
    }
    const k = this.keys;
    let throttle = k.RIGHT.isDown || k.D.isDown;
    let brake = k.LEFT.isDown || k.A.isDown;
    const half = this.scale.width / 2;
    for (const p of this.input.manager.pointers) {
      if (!p.isDown) continue;
      if (p.x >= half) throttle = true;
      else brake = true;
    }
    this.ctrl.throttle = throttle ? 1 : 0;
    this.ctrl.brake = brake ? 1 : 0;
  }

  /* Zoom so the view is VIEW_H units tall (and at least VIEW_W_MIN wide) */
  fitCamera() {
    const cam = this.cameras.main;
    const w = this.scale.width, h = this.scale.height;
    this.baseZoom = Math.min(h / RR.VIEW_H, w / RR.VIEW_W_MIN);
    cam.setZoom(this.baseZoom);
  }

  update(time, delta) {
    const dt = Math.min(delta, 100) / 1000; // clamp long frames (tab switches)
    const c = this.bike.chassis;
    this.readControls();

    // The clock starts on the first input, so nobody loses time reading the screen
    if (this.state === 'ready' && (this.ctrl.throttle || this.ctrl.brake)) {
      this.state = 'riding';
      ui.readyTip.classList.add('hidden');
      if (!this.started) trackEvent(EVENTS.GAME_START, { game: 'ridge-rider', level: this.level.id });
      this.started = true;
    }
    ui.setPads(this.ctrl.throttle, this.ctrl.brake);

    if (this.state === 'riding') {
      this.rideTime += dt;
      this.timeLeft -= dt;
      ui.setTime(this.timeLeft);
      ui.setProgress((c.position.x - this.startX) / (this.level.finishX - this.startX));
      this.checkCrash(dt);
      if (this.state === 'riding') this.updateTricks(dt);
      if (this.state === 'riding' && c.position.x >= this.level.finishX) this.finish();
      else if (this.state === 'riding' && this.timeLeft <= 0) this.timeUp();
      if (this.state === 'riding') this.recordPose();
      ui.setTimeOffer(this.state === 'riding' && this.timeExtLeft > 0 && this.timeLeft < RR.TIME_EXT_BELOW);
    }

    // Smooth follow with a look-ahead in the direction of travel
    const lookMax = Math.min(RR.CAM_LOOK_MAX, this.cameras.main.worldView.width / 4);
    const look = Phaser.Math.Clamp(c.velocity.x * this.bike.perSec * RR.CAM_LOOK_AHEAD, -lookMax, lookMax);
    const tx = c.position.x + look;
    const ty = c.position.y + RR.CAM_OFFSET_Y;
    const k = 1 - Math.pow(1 - RR.CAM_LERP, delta / 16.67); // frame-rate independent lerp
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.y += (ty - this.camPos.y) * k;
    this.cameras.main.centerOn(this.camPos.x, this.camPos.y);

    // Speed zoom: pull the camera back a little as you go faster
    const speed = Math.hypot(c.velocity.x, c.velocity.y) * this.bike.perSec;
    const live = this.state === 'riding' || this.state === 'ready';
    const zoomTarget = this.baseZoom * (1 - RR.ZOOM_OUT_AT_SPEED * Math.min(1, live ? speed / RR.ZOOM_FULL_SPEED : 0));
    const cam = this.cameras.main;
    cam.setZoom(cam.zoom + (zoomTarget - cam.zoom) * (1 - Math.pow(0.97, delta / 16.67)));

    if (this.state === 'riding') this.emitDust();

    // Engine pitch follows rear-wheel spin; brake hiss needs speed and grip
    const spin = Math.abs(this.bike.rear.angularVelocity * this.bike.perSec);
    Sound.motor.update({
      on: live && this.matter.world.enabled,
      rpm: spin / RR.MAX_WHEEL_SPIN,
      throttle: live && this.ctrl.throttle,
      brake: live && this.ctrl.brake && this.bike.onGround ? Math.min(1, speed / 500) : 0
    });

    this.streamTimer -= delta;
    if (this.streamTimer <= 0) {
      this.streamTimer = 250;
      this.updateStreaming();
    }

    this.bike.draw(this.bikeGfx);

    if (this.debugText) {
      const v = c.velocity;
      this.debugText.textContent = [
        'state ' + this.state,
        'x ' + c.position.x.toFixed(0) + ' / ' + this.level.finishX,
        'fps ' + this.game.loop.actualFps.toFixed(0),
        'speed ' + (Math.hypot(v.x, v.y) * this.bike.perSec).toFixed(0) + ' px/s',
        'angle ' + Phaser.Math.RadToDeg(c.angle).toFixed(0) + ' deg',
        'wheel spin ' + (this.bike.rear.angularVelocity * this.bike.perSec).toFixed(1) + ' rad/s',
        'ground R/F/body ' + +this.bike.touching('rearWheel') + '/' + +this.bike.touching('frontWheel') +
          '/' + +this.bike.touching('chassis')
      ].join('\n');
    }
  }

  /* Rotation-based crash rules (the head-hits-ground rule lives in setupContacts) */
  checkCrash(dt) {
    const b = this.bike, c = b.chassis;
    // Angle from upright, wrapped to -180..180 (Matter keeps adding up full turns)
    const tilt = Math.abs(Phaser.Math.RadToDeg(Phaser.Math.Angle.Wrap(c.angle)));
    const speed = Math.hypot(c.velocity.x, c.velocity.y) * b.perSec;
    // Upside down only counts once the bike is back on something: mid-air flips are fine
    const grounded = b.onGround || b.touching('chassis', 6);

    this.tipTime = tilt > RR.TIP_ANGLE && grounded ? this.tipTime + dt : 0;
    this.stuckTime = tilt > RR.STUCK_ANGLE && speed < RR.STUCK_SPEED ? this.stuckTime + dt : 0;

    if (this.tipTime >= RR.TIP_TIME) this.crash('flip');
    else if (this.stuckTime >= RR.STUCK_TIME) this.crash('stuck');
    else if (c.position.y > this.maxGroundY + RR.FALL_DEPTH) this.crash('fell');
  }

  /* Air rotation tracking + landing judgement.
   * Matter's body.angle keeps accumulating (no wrap), so rotation since take-off
   * is simply angle - startAngle. Negative = counter-clockwise = Backflip
   * (bike faces right), positive = Frontflip. */
  updateTricks(dt) {
    const b = this.bike, c = b.chassis;
    const n = RR.AIR_STEPS;
    const airborne = !b.touching('rearWheel', n) && !b.touching('frontWheel', n) && !b.touching('chassis', n);

    if (!this.air && !this.landing && airborne) {
      this.air = { start: c.angle, flips: 0, dir: null, t0: this.rideTime, vy: 0 };
    }

    if (this.air) {
      const anyTouch = b.touching('rearWheel') || b.touching('frontWheel') || b.touching('chassis');
      if (!anyTouch) {
        this.air.vy = c.velocity.y * b.perSec; // last vertical speed before touchdown
        const rot = Phaser.Math.RadToDeg(c.angle - this.air.start);
        const done = Math.floor((Math.abs(rot) + 360 - RR.FLIP_DEG) / 360);
        while (this.air.flips < done) {
          this.air.flips++;
          this.air.dir = rot < 0 ? 'Backflip' : 'Frontflip';
          const prefix = ['', 'Double ', 'Triple ', 'Quad '][Math.min(this.air.flips - 1, 3)];
          ui.pop(prefix + this.air.dir + '! +' + RR.FLIP_POINTS);
          this.cameras.main.flash(180, 255, 255, 255);
          Sound.play('star', { n: this.air.flips });
        }
      } else {
        // Touchdown: tricks must now be landed cleanly; a plain jump needs no judging
        if (this.air.flips > 0) this.landing = { t: 0, flips: this.air.flips, dir: this.air.dir };
        // Airtime counts from AIR_STEPS before we noticed (about 0.13 s)
        if (this.rideTime - this.air.t0 > 0.15) this.landingFx(Math.max(0, this.air.vy));
        this.air = null;
      }
    }

    if (this.landing) {
      const L = this.landing;
      L.t += dt;
      const slope = this.groundAngleAt(c.position.x);
      const off = Math.abs(Phaser.Math.RadToDeg(Phaser.Math.Angle.Wrap(c.angle - slope)));
      const both = b.touching('rearWheel', 2) && b.touching('frontWheel', 2);
      if (b.touching('chassis')) {
        this.crash('landing');
      } else if (both) {
        if (off <= RR.LAND_TOLERANCE) this.landTrick(L);
        else this.crash('landing');
      } else if (L.t > RR.LAND_WINDOW) {
        this.crash('landing');
      }
    }
  }

  landTrick(L) {
    this.landing = null;
    const points = L.flips * RR.FLIP_POINTS;
    this.score += points;
    this.tricks += L.flips;
    ui.setScore(this.score);
    ui.pop('Landed it! +' + points, 'good');
    Sound.play('cheer');
  }

  /* Every 0.1 s, remember where the bike was if that's a safe spot to respawn:
   * both wheels down, roughly level with the slope, not mid-trick, over real ground. */
  recordPose() {
    if (this.rideTime - this.lastSnap < 0.1) return;
    this.lastSnap = this.rideTime;
    const b = this.bike, c = b.chassis;
    const off = Math.abs(Phaser.Math.RadToDeg(Phaser.Math.Angle.Wrap(c.angle - this.groundAngleAt(c.position.x))));
    const safe = b.touching('rearWheel', 3) && b.touching('frontWheel', 3) && !this.air && !this.landing &&
      off < 25 && this.groundYAt(c.position.x) !== null;
    if (!safe) return;
    this.history.push({ t: this.rideTime, x: c.position.x, y: c.position.y, angle: Phaser.Math.Angle.Wrap(c.angle) });
    while (this.history.length && this.history[0].t < this.rideTime - 8) this.history.shift();
  }

  watchRevive() {
    if (this.state !== 'crashed' || this.revivesLeft <= 0) return;
    showRewarded(() => this.revive(), () => { /* stay on the crash modal */ });
  }

  /* Rewind to the last safe pose from at least REVIVE_REWIND seconds before the
   * crash, then wait for input again (clock paused until the player goes). */
  revive() {
    this.revivesLeft--;
    Sound.play('revive');
    trackEvent(EVENTS.REVIVE_USED, { game: 'ridge-rider', level: this.level.id, left: this.revivesLeft });
    const target = this.rideTime - RR.REVIVE_REWIND;
    let pose = null;
    for (const h of this.history) if (h.t <= target) pose = h;
    if (!pose) pose = this.history[0];
    if (!pose) {
      const s = this.level.start;
      pose = { x: s.x, y: s.y - 60, angle: 0 };
    }

    const b = this.bike;
    b.place(pose.x, pose.y - 2, pose.angle);
    b.touched = { rearWheel: -9, frontWheel: -9, chassis: -9 };
    this.history = this.history.filter((h) => h.t <= pose.t);
    this.tipTime = this.stuckTime = 0;
    this.air = this.landing = null;
    this.camPos = { x: pose.x, y: pose.y + RR.CAM_OFFSET_Y };
    this.state = 'ready';
    this.matter.world.resume();
    ui.modal.classList.add('hidden');
    ui.readyTip.classList.remove('hidden');
    this.updateStreaming(); // the rewind can land us back among removed slices
  }

  watchTimeExtension() {
    if (this.state !== 'riding' || this.timeExtLeft <= 0) return;
    this.scene.pause(); // freeze bike + clock while the ad plays
    ui.setTimeOffer(false);
    const resume = () => this.scene.resume();
    showRewarded(() => {
      this.timeExtLeft--;
      this.timeLeft += RR.TIME_EXT_SECONDS;
      ui.setTime(this.timeLeft);
      ui.pop('+' + RR.TIME_EXT_SECONDS + ' seconds!', 'good');
      trackEvent('time_extended', { game: 'ridge-rider', level: this.level.id });
      resume();
    }, resume);
  }

  crash(reason) {
    if (this.state !== 'riding' && this.state !== 'ready') return;
    this.state = 'crashed';
    const c = this.bike.chassis;
    this.burst.emitParticleAt(c.position.x, c.position.y, 22);
    this.cameras.main.shake(260, 0.012);
    Sound.play('crash');
    trackEvent(EVENTS.GAME_END, { game: 'ridge-rider', level: this.level.id, result: 'crash', reason });
    const text = {
      head: 'Ouch, right on the helmet!',
      flip: 'You flipped over. Keep it rubber side down!',
      stuck: 'Down you go. Watch your balance!',
      landing: 'Sketchy landing! Come down on both wheels, level with the slope.',
      fell: 'Into the gap! Hit the ramp with more speed.'
    }[reason];
    // Let the tumble play out for a moment, then freeze the world behind the modal
    this.time.delayedCall(RR.CRASH_MODAL_DELAY, () => {
      this.matter.world.pause();
      ui.showModal('Wipeout!', text, { revives: this.revivesLeft });
    });
  }

  finish() {
    this.state = 'finished';
    Sound.play('complete');
    this.landing = null; // crossing the line mid-trick still counts as a finish
    ui.setProgress(1);

    const timeBonus = Math.ceil(Math.max(0, this.timeLeft)) * RR.TIME_BONUS;
    const total = this.score + timeBonus;
    const bestKey = STORE.BEST + this.level.id;
    const best = load(bestKey, 0);
    if (total > best) save(bestKey, total);
    const last = this.levelIndex >= RR_LEVELS.length - 1;
    if (!last) {
      save(STORE.UNLOCKED, Math.max(load(STORE.UNLOCKED, 0), this.levelIndex + 1));
      save(STORE.LEVEL, this.levelIndex + 1);
    }
    trackEvent(EVENTS.GAME_END, {
      game: 'ridge-rider', level: this.level.id, result: 'finish',
      time: +this.rideTime.toFixed(1), tricks: this.tricks, score: total
    });

    this.time.delayedCall(900, () => {
      this.matter.world.pause();
      ui.showModal('Level Complete!', total > best ? 'New best score!' : 'Best: ' + best, {
        stats: [
          ['Total Time', this.rideTime.toFixed(1) + 's'],
          ['Tricks Performed', this.tricks],
          ['Score', total]
        ],
        next: last ? 'Start Over at Level 1' : 'Next Level'
      });
    });
  }

  timeUp() {
    this.state = 'timeup';
    Sound.play('gameover');
    ui.setTime(0);
    const pct = Math.round(Phaser.Math.Clamp(
      (this.bike.chassis.position.x - this.startX) / (this.level.finishX - this.startX), 0, 1) * 100);
    trackEvent(EVENTS.GAME_END, { game: 'ridge-rider', level: this.level.id, result: 'timeup', progress: pct });
    this.matter.world.pause();
    ui.showModal("Time's Up!", 'You made it ' + pct + '% of the way. So close!');
  }

  retry() {
    this.scene.restart({ level: this.levelIndex });
  }

  nextLevel() {
    this.scene.restart({ level: (this.levelIndex + 1) % RR_LEVELS.length });
  }
}

const scene = () => game.scene.getScene('ride');

/* =========================================================
 * 5. Boot
 * ========================================================= */
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: Math.round(appEl.clientWidth * DPR),
  height: Math.round(appEl.clientHeight * DPR),
  transparent: true,            // sky comes from the page's CSS gradient
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { y: RR.GRAVITY },
      positionIterations: 8,
      velocityIterations: 6,
      constraintIterations: 4,
      enableSleeping: false,
      debug: DEBUG
    }
  },
  scene: RideScene
});

// Keep the canvas at device resolution when the window / orientation changes
window.addEventListener('resize', () => {
  game.scale.resize(Math.round(appEl.clientWidth * DPR), Math.round(appEl.clientHeight * DPR));
});

levelSelect.show(false); // the game opens on the level select

// Test hook (headless checks / console tinkering)
window.RidgeRider = { game, RR, levelSelect, get scene() { return game.scene.getScene('ride'); } };
