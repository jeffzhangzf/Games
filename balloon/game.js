/* =========================================================
 * balloon/game.js — Balloon Pop ("打气球") game logic
 *
 * Purpose: Phaser 3 scene for the 60-second balloon-popping game:
 *   - balloons rise from the carnival stall at the bottom
 *   - tap / click a balloon to pop it (normal +10, gold +50, bomb -20)
 *   - 30-shot magazine, automatic 0.5s reload when empty
 *   - three difficulty phases (speed / size / bomb rate) over the 60 seconds
 *   - result screen with score, best score and accuracy
 *
 * Ads (all through shared/ads.js — nothing here reports ad events itself):
 *   - interstitial: 2s after the result screen appears (frequency capped by ads.js)
 *   - rewarded "double score" button on the result screen, once per round
 *   - bottom banner #ad-banner
 *   While ads are switched off in ads.js, the interstitial is skipped and the
 *   double-score button is hidden (data-noad-hide), so none of this shows up.
 *
 * Depends on (loaded in this order by balloon/index.html):
 *   Phaser 3 (CDN) → shared/analytics.js → shared/ads.js → shared/sound.js → this file
 *
 * Core loop (BalloonScene.update):
 *   1. count down the round timer (only while playing; Phaser pauses the
 *      whole loop when the tab is hidden, so time never runs in the background)
 *   2. pick the current difficulty phase from the elapsed time
 *   3. spawn balloons on a fixed interval for that phase
 *   4. move every active balloon up (+ a gentle sway), recycle the ones
 *      that float off the top
 *   5. count down the reload timer
 *   Shooting happens in the pointerdown handler (shoot()).
 *
 * Units: the canvas is created at real device pixels (CSS size × devicePixelRatio);
 * every size and speed below is written for a 400-wide design and multiplied by S.
 *
 * Performance:
 *   - balloons come from an object pool (obtainBalloon / releaseBalloon): a popped
 *     or escaped balloon is hidden and reused instead of being destroyed
 *   - balloons that float off the top are recycled immediately
 *   - the game pauses (with a "continue" screen) when the tab is hidden or the
 *     window loses focus, so the timer never runs while nobody is looking
 *
 * localStorage keys:
 *   balloon_best            best score
 *   balloon_tutorial_seen   "1" once the first-time hint has been shown
 * ========================================================= */

(function () {
  'use strict';

  // Phaser comes from a CDN: if it failed to load, say so instead of a blank page
  if (typeof window.Phaser === 'undefined') {
    const text = document.getElementById('loading-text');
    text.textContent = 'Failed to load. Check your connection and try again.';
    document.querySelector('#loading .bar').style.display = 'none';
    const retry = document.createElement('button');
    retry.className = 'retry';
    retry.textContent = 'Reload';
    retry.addEventListener('click', () => location.reload());
    text.parentNode.appendChild(retry);
    return;
  }

  /* =========================================================
   * 1. Settings — tweak the game here
   * ========================================================= */
  const CONFIG = {
    BASE_WIDTH: 400,        // design width; sizes/speeds below are in design units
    MAX_DPR: 2,             // cap device pixel ratio for performance
    ROUND_TIME: 60,         // seconds per round
    MAG_SIZE: 30,           // shots per magazine
    RELOAD_MS: 500,         // reload time when the magazine is empty (ms)
    HIT_PADDING: 1.15,      // hit area = balloon body × this (slightly generous for fingers)
    SCORE: { normal: 10, gold: 50, bomb: -20 },
    GOLD_SPEED_MULT: 1.35,  // gold balloons rise faster
    TICK_FROM: 5,           // tick sound during the last N seconds
    MAX_DT: 100,            // clamp frame delta (ms) so a hiccup can't teleport balloons
    CLOUD_COUNT: 5,
    CLOUD_SPEED: [6, 16],   // cloud drift speed range
    STALL_HEIGHT: 86,       // carnival stall at the bottom
    CROSSHAIR_R: 22,        // crosshair ring radius
    TEX_R: 40,              // balloon texture radius (balloons are scaled from this)
    BEST_KEY: 'balloon_best',
    TUTORIAL_KEY: 'balloon_tutorial_seen',
    TUTORIAL_MAX_MS: 8000,  // first-time hint disappears after this even without a hit
    MIN_TAP_GAP: 50,        // taps closer together than this (ms) are ignored (auto-clickers)
    INTERSTITIAL_DELAY: 2000 // ms after the result screen appears
  };

  /**
   * Difficulty phases, chosen by elapsed time.
   *   until       phase lasts until this many seconds have passed
   *   speed       rise speed range (design px / second)
   *   radius      balloon body radius (design px) — bigger = easier
   *   spawnEvery  ms between new balloons
   *   goldRate    chance a new balloon is gold
   *   bombRate    chance a new balloon is a bomb
   *   banner      text shown when the phase starts (null = none)
   */
  const PHASES = [
    { until: 20, speed: [80, 120],  radius: 34, spawnEvery: 650, goldRate: 0.08, bombRate: 0.10, banner: null },
    { until: 40, speed: [120, 180], radius: 28, spawnEvery: 520, goldRate: 0.08, bombRate: 0.10, banner: 'Speeding up!' },
    { until: 60, speed: [180, 260], radius: 22, spawnEvery: 420, goldRate: 0.08, bombRate: 0.18, banner: 'Final rush! More bombs incoming' }
  ];

  // Normal balloon colours (red / blue / green / yellow / purple)
  const BALLOON_COLORS = [0xff5a5f, 0x4d7cfe, 0x2ead6b, 0xffc93c, 0x9b5de5];
  const GOLD_COLOR = 0xf2b705;
  const BOMB_COLOR = 0x2b2d42;

  /* =========================================================
   * 2. Safe wrappers for shared modules (the game still runs without them)
   * ========================================================= */
  const EV = window.EVENTS || {};
  const track = (name, params) => {
    if (typeof window.trackEvent === 'function') window.trackEvent(name, params);
  };
  const Sound = window.Sound || { play() {}, toggle() { return true; }, isMuted() { return true; } };
  const sfx = (name) => Sound.play(name);

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
  }

  /* =========================================================
   * 3. Canvas size (real pixels) & scale factor
   * ========================================================= */
  const gameEl = document.getElementById('game');
  const DPR = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
  const GAME_W = Math.round(gameEl.clientWidth * DPR);
  const GAME_H = Math.round(gameEl.clientHeight * DPR);
  const S = GAME_W / CONFIG.BASE_WIDTH;
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';

  /* =========================================================
   * 4. DOM (HUD & overlays)
   * ========================================================= */
  const $ = (id) => document.getElementById(id);
  const ui = {
    score: $('score'),
    time: $('time'),
    timeBox: $('time-box'),
    timeBar: $('time-bar'),
    ammo: $('ammo'),
    ammoBox: $('ammo-box'),
    reload: $('reload'),
    btnMute: $('btn-mute'),
    startScreen: $('start-screen'),
    btnStart: $('btn-start'),
    resultScreen: $('result-screen'),
    finalScore: $('final-score'),
    newBest: $('new-best'),
    finalBest: $('final-best'),
    finalAccuracy: $('final-accuracy'),
    finalHits: $('final-hits'),
    btnAgain: $('btn-again'),
    btnDouble: $('btn-double'),
    app: $('app'),
    loading: $('loading'),
    tutorial: $('tutorial'),
    pauseScreen: $('pause-screen'),
    btnResume: $('btn-resume')
  };
  const DOUBLE_TEXT = ui.btnDouble.textContent;
  ui.reload.style.setProperty('--reload-ms', CONFIG.RELOAD_MS + 'ms');

  /* =========================================================
   * 5. Scene
   * ========================================================= */
  class BalloonScene extends Phaser.Scene {
    constructor() {
      super('BalloonScene');
    }

    create() {
      this.makeTextures();
      this.createClouds();
      this.createStall();
      this.createCrosshair();

      this.active = [];   // balloons currently flying
      this.pool = [];     // popped / escaped balloons waiting to be reused
      this.status = 'ready'; // 'ready' | 'playing' | 'over'
      this.tutRing = this.add.graphics().setDepth(40); // first-time hint ring

      this.input.on('pointerdown', (p) => this.onPointerDown(p));

      // Everything is drawn: fade out the loading screen
      ui.loading.classList.add('done');
      setTimeout(() => ui.loading.remove(), 400);
    }

    /* ---------------- Textures (drawn once, no image files) ---------------- */

    makeTextures() {
      // Cloud: a few overlapping white circles
      const cw = Math.round(120 * S);
      const ch = Math.round(56 * S);
      const g = this.make.graphics({ add: false });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(cw * 0.28, ch * 0.62, ch * 0.36);
      g.fillCircle(cw * 0.48, ch * 0.42, ch * 0.42);
      g.fillCircle(cw * 0.7, ch * 0.58, ch * 0.34);
      g.fillRoundedRect(cw * 0.12, ch * 0.55, cw * 0.76, ch * 0.4, ch * 0.2);
      g.generateTexture('cloud', cw, ch);
      g.destroy();

      // Crosshair: ring + four ticks + centre dot (toy / arcade style, no gun shape)
      const r = CONFIG.CROSSHAIR_R * S;
      const size = Math.ceil(r * 2 + 12 * S);
      const c = size / 2;
      const x = this.make.graphics({ add: false });
      x.lineStyle(3 * S, 0xe63946, 1);
      x.strokeCircle(c, c, r);
      const inner = r * 0.45;
      const outer = r + 5 * S;
      x.lineBetween(c, c - outer, c, c - inner);
      x.lineBetween(c, c + inner, c, c + outer);
      x.lineBetween(c - outer, c, c - inner, c);
      x.lineBetween(c + inner, c, c + outer, c);
      x.fillStyle(0xe63946, 1);
      x.fillCircle(c, c, 2.5 * S);
      x.generateTexture('crosshair', size, size);
      x.destroy();

      // Particle dot (tinted per balloon colour)
      const dr = Math.max(2, Math.round(4 * S));
      const d = this.make.graphics({ add: false });
      d.fillStyle(0xffffff, 1);
      d.fillCircle(dr, dr, dr);
      d.generateTexture('dot', dr * 2, dr * 2);
      d.destroy();

      // Balloons
      BALLOON_COLORS.forEach((color, i) => this.makeBalloonTexture('b_normal_' + i, color, 'normal'));
      this.makeBalloonTexture('b_gold', GOLD_COLOR, 'gold');
      this.makeBalloonTexture('b_bomb', BOMB_COLOR, 'bomb');
    }

    /**
     * One balloon texture: oval body, shine, knot and a wavy string.
     * The image origin is set to the body centre (see BALLOON_ORIGIN_Y) so
     * balloon.x / balloon.y always mean "centre of the body" for hit tests.
     */
    makeBalloonTexture(key, color, kind) {
      const R = CONFIG.TEX_R * S;
      const rx = R * 0.9;
      const ry = R * 1.05;
      const pad = R * 0.35;                 // room for the bomb fuse on top
      const w = Math.ceil(rx * 2 + 4 * S);
      const h = Math.ceil(pad + ry * 2 + R * 1.3);
      const cx = w / 2;
      const cy = pad + ry;
      const g = this.make.graphics({ add: false });

      // String
      g.lineStyle(1.5 * S, 0x6b7c8f, 0.9);
      g.beginPath();
      g.moveTo(cx, cy + ry + R * 0.12);
      g.lineTo(cx - R * 0.08, cy + ry + R * 0.5);
      g.lineTo(cx + R * 0.08, cy + ry + R * 0.85);
      g.lineTo(cx, cy + ry + R * 1.25);
      g.strokePath();

      // Knot
      g.fillStyle(color, 1);
      g.fillTriangle(cx, cy + ry - R * 0.05, cx - R * 0.12, cy + ry + R * 0.14, cx + R * 0.12, cy + ry + R * 0.14);

      // Body
      g.fillEllipse(cx, cy, rx * 2, ry * 2);

      // Shine
      g.fillStyle(0xffffff, kind === 'bomb' ? 0.18 : 0.35);
      g.fillEllipse(cx - rx * 0.35, cy - ry * 0.4, rx * 0.45, ry * 0.55);

      if (kind === 'gold') {
        // Little sparkle star
        g.fillStyle(0xffffff, 0.95);
        const sx = cx + rx * 0.3;
        const sy = cy - ry * 0.15;
        const sl = R * 0.28;
        g.fillTriangle(sx, sy - sl, sx - sl * 0.25, sy, sx + sl * 0.25, sy);
        g.fillTriangle(sx, sy + sl, sx - sl * 0.25, sy, sx + sl * 0.25, sy);
        g.fillTriangle(sx - sl, sy, sx, sy - sl * 0.25, sx, sy + sl * 0.25);
        g.fillTriangle(sx + sl, sy, sx, sy - sl * 0.25, sx, sy + sl * 0.25);
      }

      if (kind === 'bomb') {
        // Fuse + spark on top, and a white "!" so it reads as dangerous
        g.lineStyle(3 * S, 0x8c5e3c, 1);
        g.beginPath();
        g.moveTo(cx, cy - ry + R * 0.05);
        g.lineTo(cx + R * 0.12, cy - ry - R * 0.15);
        g.lineTo(cx + R * 0.05, cy - ry - R * 0.28);
        g.strokePath();
        g.fillStyle(0xff9f1c, 1);
        g.fillCircle(cx + R * 0.05, cy - ry - R * 0.28, R * 0.1);
        g.fillStyle(0xffe066, 1);
        g.fillCircle(cx + R * 0.05, cy - ry - R * 0.28, R * 0.05);
        g.fillStyle(0xffffff, 0.9);
        g.fillRoundedRect(cx - R * 0.07, cy - R * 0.45, R * 0.14, R * 0.55, R * 0.06);
        g.fillCircle(cx, cy + R * 0.32, R * 0.08);
      }

      g.generateTexture(key, w, h);
      g.destroy();
      this.balloonOriginY = cy / h; // same layout for every balloon texture
    }

    /* ---------------- Scenery ---------------- */

    /** Clouds drift slowly to the right and wrap around */
    createClouds() {
      this.clouds = [];
      const skyBottom = GAME_H - CONFIG.STALL_HEIGHT * S;
      for (let i = 0; i < CONFIG.CLOUD_COUNT; i++) {
        const cloud = this.add.image(
          Phaser.Math.Between(0, GAME_W),
          Phaser.Math.Between(GAME_H * 0.1, skyBottom * 0.75),
          'cloud'
        );
        const scale = Phaser.Math.FloatBetween(0.6, 1.2);
        cloud.setScale(scale).setAlpha(Phaser.Math.FloatBetween(0.55, 0.9));
        // Bigger clouds look closer → move faster (simple parallax)
        cloud.speed = Phaser.Math.Linear(CONFIG.CLOUD_SPEED[0], CONFIG.CLOUD_SPEED[1], (scale - 0.6) / 0.6) * S;
        this.clouds.push(cloud);
      }
    }

    /** Carnival stall along the bottom: striped counter + a row of small tied balloons */
    createStall() {
      const h = CONFIG.STALL_HEIGHT * S;
      const top = GAME_H - h;
      const g = this.add.graphics().setDepth(5);

      const count = 9;
      const gap = GAME_W / count;
      for (let i = 0; i < count; i++) {
        const bx = gap * (i + 0.5);
        const by = top - 16 * S - (i % 2) * 8 * S;    // float above the counter, slight up/down rhythm
        const r = 11 * S;
        const color = BALLOON_COLORS[i % BALLOON_COLORS.length];
        g.lineStyle(1.5 * S, 0x6b7c8f, 0.8);
        g.lineBetween(bx, by + r, bx, top + 14 * S);
        g.fillStyle(color, 1);
        g.fillEllipse(bx, by, r * 1.7, r * 2);
        g.fillStyle(0xffffff, 0.35);
        g.fillEllipse(bx - r * 0.3, by - r * 0.35, r * 0.45, r * 0.6);
      }

      const counterTop = top + 12 * S;
      const stripe = 26 * S;
      for (let x = 0, n = 0; x < GAME_W; x += stripe, n++) {
        g.fillStyle(n % 2 ? 0xffffff : 0xe63946, 1);
        g.fillRect(x, counterTop, stripe, GAME_H - counterTop);
      }
      g.fillStyle(0xb5835a, 1);
      g.fillRect(0, counterTop - 6 * S, GAME_W, 10 * S);
      g.fillStyle(0x8c5e3c, 1);
      g.fillRect(0, counterTop + 4 * S, GAME_W, 3 * S);

      this.stallTop = counterTop - 6 * S; // balloons start hidden behind the counter
    }

    /** Crosshair follows the pointer; on touch it jumps to where the finger is */
    createCrosshair() {
      this.crosshair = this.add.image(GAME_W / 2, GAME_H * 0.45, 'crosshair').setDepth(100);
      this.input.on('pointermove', (p) => {
        if (!this.crosshairBusy) this.crosshair.setPosition(p.x, p.y);
      });
    }

    /* ---------------- Round flow ---------------- */

    startRound() {
      // Recycle every balloon left over from the previous round
      for (const b of this.active) this.releaseBalloon(b);
      this.active.length = 0;

      this.status = 'playing';
      this.roundNo = (this.roundNo || 0) + 1; // invalidates delayed calls from the previous round
      this.timeLeft = CONFIG.ROUND_TIME;
      this.score = 0;
      this.shots = 0;
      this.hits = 0;
      this.ammo = CONFIG.MAG_SIZE;
      this.reloadLeft = 0;
      this.spawnTimer = 0;
      this.phaseIndex = 0;
      this.lastTick = -1;
      this.lastTapAt = -Infinity;
      this.ignoredTaps = 0;
      this.hudCache = {};
      // First-time hint: only until the player has seen it once
      this.tutorialOn = !storageGet(CONFIG.TUTORIAL_KEY);
      this.tutorialMs = 0;
      this.tutorialTarget = null;
      ui.tutorial.hidden = !this.tutorialOn;
      ui.reload.hidden = true;
      this.updateHud();
      track(EV.GAME_START, { game: 'balloon' });
    }

    endRound() {
      this.status = 'over';
      if (this.tutorialOn) this.endTutorial();
      ui.reload.hidden = true;
      const accuracy = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
      const best = parseInt(storageGet(CONFIG.BEST_KEY), 10) || 0;
      const isBest = this.score > best;
      if (isBest) storageSet(CONFIG.BEST_KEY, this.score);

      track(EV.GAME_END, { game: 'balloon', score: this.score, accuracy: accuracy, ignored_taps: this.ignoredTaps });
      sfx(isBest && this.score > 0 ? 'win' : 'gameover');

      ui.finalScore.textContent = this.score;
      ui.newBest.hidden = !isBest || this.score === 0;
      ui.finalBest.textContent = Math.max(best, this.score);
      ui.finalAccuracy.textContent = accuracy + '%';
      ui.finalHits.textContent = this.hits;
      this.best = Math.max(best, this.score);
      this.doubled = false;
      ui.btnDouble.disabled = false;
      ui.btnDouble.textContent = DOUBLE_TEXT;

      const round = this.roundNo;
      // Short pause so the last pop is visible before the result card appears
      this.time.delayedCall(500, () => {
        if (this.status !== 'over' || round !== this.roundNo) return;
        ui.resultScreen.hidden = false;
        // Interstitial a moment after the result is on screen — never during play.
        // Frequency (every 2nd call) is handled by ads.js.
        this.time.delayedCall(CONFIG.INTERSTITIAL_DELAY, () => {
          if (this.status === 'over' && round === this.roundNo && typeof window.showInterstitial === 'function') {
            window.showInterstitial();
          }
        });
      });
    }

    /** Rewarded ad finished: double this round's score (once per round) */
    applyDoubleScore() {
      if (this.doubled || this.status !== 'over') return;
      this.doubled = true;
      this.score *= 2;
      ui.finalScore.textContent = this.score;
      ui.finalScore.classList.remove('bump');
      void ui.finalScore.offsetWidth;
      ui.finalScore.classList.add('bump');
      if (this.score > this.best) {
        this.best = this.score;
        storageSet(CONFIG.BEST_KEY, this.score);
        ui.newBest.hidden = false;
      }
      ui.finalBest.textContent = this.best;
      ui.btnDouble.textContent = 'Score doubled ✓';
      ui.btnDouble.disabled = true;
      sfx('win');
      track(EV.REWARDED_UNLOCKED, { game: 'balloon', type: 'double_score' });
    }

    /** Current difficulty phase from elapsed time */
    currentPhase() {
      const elapsed = CONFIG.ROUND_TIME - this.timeLeft;
      let i = 0;
      while (i < PHASES.length - 1 && elapsed >= PHASES[i].until) i++;
      return i;
    }

    /* ---------------- Balloons: spawn, pool, move ---------------- */

    /** Take a balloon image from the pool (or make a new one) */
    obtainBalloon() {
      const b = this.pool.pop() || this.add.image(0, 0, 'b_normal_0').setDepth(2);
      b.setActive(true).setVisible(true).setAlpha(1);
      b.setOrigin(0.5, this.balloonOriginY);
      return b;
    }

    /** Return a balloon to the pool */
    releaseBalloon(b) {
      this.tweens.killTweensOf(b);
      b.setActive(false).setVisible(false);
      this.pool.push(b);
    }

    spawnBalloon(phase) {
      const roll = Math.random();
      const kind = roll < phase.bombRate ? 'bomb' : roll < phase.bombRate + phase.goldRate ? 'gold' : 'normal';
      const colorIndex = Phaser.Math.Between(0, BALLOON_COLORS.length - 1);
      const r = phase.radius * S * Phaser.Math.FloatBetween(0.92, 1.08);
      const b = this.obtainBalloon();

      b.setTexture(kind === 'normal' ? 'b_normal_' + colorIndex : 'b_' + kind);
      b.setScale(r / (CONFIG.TEX_R * S));
      b.kind = kind;
      b.color = kind === 'normal' ? BALLOON_COLORS[colorIndex] : kind === 'gold' ? GOLD_COLOR : BOMB_COLOR;
      b.r = r;
      b.speed = Phaser.Math.FloatBetween(phase.speed[0], phase.speed[1]) * S * (kind === 'gold' ? CONFIG.GOLD_SPEED_MULT : 1);
      b.baseX = Phaser.Math.FloatBetween(r * 1.1, GAME_W - r * 1.1);
      b.sway = Phaser.Math.FloatBetween(0, Math.PI * 2);
      b.x = b.baseX;
      b.y = this.stallTop + r * 1.05; // body just hidden behind the counter
      this.active.push(b);
    }

    moveBalloons(dt) {
      const t = this.time.now / 1000;
      for (let i = this.active.length - 1; i >= 0; i--) {
        const b = this.active[i];
        b.y -= b.speed * dt;
        b.x = b.baseX + Math.sin(t * 1.6 + b.sway) * 6 * S;
        // Floated off the top (string included) → recycle
        if (b.y + b.r * 2.5 < 0) {
          this.active.splice(i, 1);
          this.releaseBalloon(b);
        }
      }
    }

    /** Topmost balloon under (x, y), or null. Uses the oval body, slightly enlarged. */
    balloonAt(x, y) {
      if (y > this.stallTop) return null; // balloons hidden behind the counter can't be hit
      for (let i = this.active.length - 1; i >= 0; i--) {
        const b = this.active[i];
        const rx = b.r * 0.9 * CONFIG.HIT_PADDING;
        const ry = b.r * 1.05 * CONFIG.HIT_PADDING;
        const dx = (x - b.x) / rx;
        const dy = (y - b.y) / ry;
        if (dx * dx + dy * dy <= 1) return b;
      }
      return null;
    }

    /* ---------------- Shooting ---------------- */

    onPointerDown(p) {
      this.crosshair.setPosition(p.x, p.y);
      if (this.status !== 'playing') return;

      // Light anti-cheat: taps < 50ms apart are almost certainly an auto-clicker.
      // They are ignored (no shot, no ammo used) and counted for analytics.
      const now = performance.now();
      const gap = now - this.lastTapAt;
      this.lastTapAt = now;
      if (gap < CONFIG.MIN_TAP_GAP) {
        this.ignoredTaps++;
        return;
      }

      if (this.reloadLeft > 0) {
        sfx('dryFire'); // still reloading
        return;
      }
      this.shoot(p.x, p.y);
    }

    shoot(x, y) {
      this.shots++;
      this.ammo--;
      sfx('shoot');
      this.recoil();

      const b = this.balloonAt(x, y);
      if (b) this.popBalloon(b);
      else this.miss();

      if (this.ammo <= 0) this.startReload();
      this.updateHud();
    }

    /** Crosshair "kick": quick squeeze plus a tiny random jolt */
    recoil() {
      const c = this.crosshair;
      this.tweens.killTweensOf(c);   // also cancels an unfinished miss-shake…
      this.crosshairBusy = false;    // …so let the crosshair follow the pointer again
      c.setScale(1.3);
      this.tweens.add({ targets: c, scale: 1, duration: 140, ease: 'Back.easeOut' });
    }

    miss() {
      sfx('dryFire');
      // Shake the crosshair left-right
      const c = this.crosshair;
      const x0 = c.x;
      this.crosshairBusy = true;
      this.tweens.add({
        targets: c,
        x: { from: x0 - 6 * S, to: x0 + 6 * S },
        duration: 50,
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          c.x = x0;
          this.crosshairBusy = false;
        }
      });
    }

    popBalloon(b) {
      // Remove from the active list right away so it can't be hit twice
      this.active.splice(this.active.indexOf(b), 1);
      this.hits++;
      if (this.tutorialOn && b.kind !== 'bomb') this.endTutorial(); // got it!

      const points = CONFIG.SCORE[b.kind];
      this.score = Math.max(0, this.score + points);
      track(EV.BALLOON_HIT, { type: b.kind });

      if (b.kind === 'gold') sfx('popGold');
      else if (b.kind === 'bomb') sfx('bomb');
      else sfx('pop');

      this.burst(b);
      this.floatText(b.x, b.y, (points > 0 ? '+' : '') + points, b.kind);
      if (b.kind === 'bomb') {
        this.cameras.main.flash(260, 230, 57, 70);
        this.cameras.main.shake(180, 0.006);
      }

      // Balloon itself: puff up and vanish, then back to the pool
      this.tweens.add({
        targets: b,
        scaleX: b.scaleX * 1.35,
        scaleY: b.scaleY * 1.35,
        alpha: 0,
        duration: 110,
        onComplete: () => this.releaseBalloon(b)
      });
    }

    /** Particle burst in the balloon's colour */
    burst(b) {
      const n = b.kind === 'normal' ? 10 : 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const dist = b.r * Phaser.Math.FloatBetween(1.1, 1.9);
        const p = this.add.image(b.x, b.y, 'dot').setDepth(50).setTint(b.kind === 'bomb' ? 0xff9f1c : b.color);
        p.setScale(Phaser.Math.FloatBetween(0.7, 1.3));
        this.tweens.add({
          targets: p,
          x: b.x + Math.cos(a) * dist,
          y: b.y + Math.sin(a) * dist,
          scale: 0.2,
          alpha: 0,
          duration: Phaser.Math.Between(280, 420),
          ease: 'Cubic.easeOut',
          onComplete: () => p.destroy()
        });
      }
    }

    /** Score text floating up from the balloon */
    floatText(x, y, text, kind) {
      const color = kind === 'bomb' ? '#e63946' : kind === 'gold' ? '#c98a00' : '#1f4e6e';
      const t = this.add.text(x, y, text, {
        fontFamily: FONT,
        fontSize: Math.round((kind === 'normal' ? 20 : 26) * S) + 'px',
        fontStyle: 'bold',
        color: color,
        stroke: '#ffffff',
        strokeThickness: Math.round(5 * S)
      }).setOrigin(0.5).setDepth(60);
      this.tweens.add({
        targets: t,
        y: y - 50 * S,
        alpha: 0,
        duration: 700,
        ease: 'Cubic.easeOut',
        onComplete: () => t.destroy()
      });
    }

    /* ---------------- Reload ---------------- */

    startReload() {
      this.reloadLeft = CONFIG.RELOAD_MS;
      ui.reload.hidden = false;
      ui.reload.classList.remove('running');
      void ui.reload.offsetWidth; // restart the progress-bar animation
      ui.reload.classList.add('running');
      track(EV.RELOAD, { game: 'balloon' });
    }

    finishReload() {
      this.reloadLeft = 0;
      this.ammo = CONFIG.MAG_SIZE;
      ui.reload.hidden = true;
      sfx('reload');
      this.updateHud();
    }

    /* ---------------- First-time tutorial ---------------- */

    /** Pulse a ring around the first catchable balloon until the player pops one */
    updateTutorial(dtMs) {
      this.tutorialMs += dtMs;
      if (this.tutorialMs > CONFIG.TUTORIAL_MAX_MS) {
        this.endTutorial();
        return;
      }
      let b = this.tutorialTarget;
      if (!b || !b.active || !this.active.includes(b)) {
        b = this.tutorialTarget = this.active.find((x) => x.kind === 'normal' && x.y < this.stallTop - x.r * 1.5) || null;
      }
      this.tutRing.clear();
      if (!b) return;
      const r = b.r * 1.5 * (1 + 0.1 * Math.sin(this.time.now / 110));
      this.tutRing.lineStyle(4 * S, 0xf2b705, 0.95);
      this.tutRing.strokeCircle(b.x, b.y, r);
    }

    endTutorial() {
      this.tutorialOn = false;
      this.tutRing.clear();
      ui.tutorial.hidden = true;
      storageSet(CONFIG.TUTORIAL_KEY, '1');
    }

    /* ---------------- Banner (phase change) ---------------- */

    showBanner(text) {
      const t = this.add.text(GAME_W / 2, GAME_H * 0.38, text, {
        fontFamily: FONT,
        fontSize: Math.round(28 * S) + 'px',
        fontStyle: 'bold',
        color: '#e63946',
        stroke: '#ffffff',
        strokeThickness: Math.round(7 * S)
      }).setOrigin(0.5).setDepth(70).setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 1100, duration: 300, onComplete: () => t.destroy() });
    }

    /* ---------------- HUD (DOM) ---------------- */

    /** Write HUD values; only touches the DOM when something changed */
    updateHud() {
      const c = this.hudCache;
      const secs = Math.max(0, Math.ceil(this.timeLeft));
      const ammoText = this.reloadLeft > 0 ? 'Reload' : this.ammo + '/' + CONFIG.MAG_SIZE;
      if (c.score !== this.score) ui.score.textContent = c.score = this.score;
      if (c.secs !== secs) {
        ui.time.textContent = (c.secs = secs) + 's';
        ui.timeBox.classList.toggle('hurry', secs <= CONFIG.TICK_FROM && this.status === 'playing');
      }
      if (c.ammo !== ammoText) {
        ui.ammo.textContent = c.ammo = ammoText;
        ui.ammoBox.classList.toggle('low', this.reloadLeft > 0 || this.ammo <= 5);
      }
      ui.timeBar.style.width = (Math.max(0, this.timeLeft) / CONFIG.ROUND_TIME) * 100 + '%';
    }

    /* ---------------- Main loop ---------------- */

    update(time, delta) {
      const dtMs = Math.min(delta, CONFIG.MAX_DT);
      const dt = dtMs / 1000;

      // Clouds always drift, even on the start / result screens
      for (const cloud of this.clouds) {
        cloud.x += cloud.speed * dt;
        if (cloud.x - cloud.displayWidth / 2 > GAME_W) cloud.x = -cloud.displayWidth / 2;
      }

      // Balloons keep floating away after the round ends (looks nicer than freezing)
      this.moveBalloons(dt);
      if (this.status !== 'playing') return;

      // 1. Timer
      this.timeLeft -= dt;
      const secs = Math.ceil(this.timeLeft);
      if (secs <= CONFIG.TICK_FROM && secs > 0 && secs !== this.lastTick) {
        this.lastTick = secs;
        sfx('tick');
      }

      // 2. Phase
      const pi = this.currentPhase();
      if (pi !== this.phaseIndex) {
        this.phaseIndex = pi;
        if (PHASES[pi].banner) this.showBanner(PHASES[pi].banner);
      }
      const phase = PHASES[pi];

      // 3. Spawning
      this.spawnTimer += dtMs;
      while (this.spawnTimer >= phase.spawnEvery) {
        this.spawnTimer -= phase.spawnEvery;
        this.spawnBalloon(phase);
      }

      if (this.tutorialOn) this.updateTutorial(dtMs);

      // 4. Reload
      if (this.reloadLeft > 0) {
        this.reloadLeft -= dtMs;
        if (this.reloadLeft <= 0) this.finishReload();
      }

      this.updateHud();
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.updateHud();
        this.endRound();
      }
    }
  }

  /* =========================================================
   * 6. Boot & buttons
   * ========================================================= */
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_W,
    height: GAME_H,
    transparent: true, // the sky gradient is CSS on #app
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: BalloonScene
  });
  const scene = () => game.scene.getScene('BalloonScene');

  ui.btnStart.addEventListener('click', () => {
    ui.startScreen.hidden = true;
    scene().startRound();
  });
  ui.btnAgain.addEventListener('click', () => {
    ui.resultScreen.hidden = true;
    scene().startRound();
  });
  ui.btnDouble.addEventListener('click', () => {
    const s = scene();
    if (s.doubled || s.status !== 'over' || typeof window.showRewarded !== 'function') return;
    ui.btnDouble.disabled = true; // no double-tapping into two ads
    window.showRewarded(
      () => s.applyDoubleScore(),
      () => { ui.btnDouble.disabled = false; } // closed early: allow another try
    );
  });

  // Bottom banner (no-op while ads are switched off)
  if (typeof window.showBanner === 'function') window.showBanner('ad-banner');

  function updateMuteUI() {
    ui.btnMute.textContent = Sound.isMuted() ? '🔇' : '🔊';
  }
  updateMuteUI();
  ui.btnMute.addEventListener('click', () => {
    Sound.toggle();
    updateMuteUI();
  });

  // Landscape on phones: pause while the "rotate" tip covers the game
  const LANDSCAPE_QUERY = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
  const loadedInLandscape = LANDSCAPE_QUERY.matches;
  function onOrientationChange() {
    if (LANDSCAPE_QUERY.matches) game.scene.pause('BalloonScene');
    else if (loadedInLandscape) location.reload(); // canvas size was fixed in landscape
    else if (!userPaused) game.scene.resume('BalloonScene');
  }

  // Pause when the tab is hidden or the window loses focus (only mid-round),
  // then wait for the player to tap "continue": no surprise restarts
  let userPaused = false;
  function pauseGame() {
    const s = scene();
    if (userPaused || !s || s.status !== 'playing') return;
    userPaused = true;
    game.scene.pause('BalloonScene');
    ui.app.classList.add('paused');
    ui.pauseScreen.hidden = false;
  }
  function resumeGame() {
    if (!userPaused) return;
    userPaused = false;
    ui.app.classList.remove('paused');
    ui.pauseScreen.hidden = true;
    if (!LANDSCAPE_QUERY.matches) game.scene.resume('BalloonScene');
  }
  window.addEventListener('blur', pauseGame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });
  ui.btnResume.addEventListener('click', resumeGame);
  if (LANDSCAPE_QUERY.addEventListener) LANDSCAPE_QUERY.addEventListener('change', onOrientationChange);
  else LANDSCAPE_QUERY.addListener(onOrientationChange);

  // Debug handle (e.g. BalloonGame.scene().timeLeft = 3)
  window.BalloonGame = { scene: scene, CONFIG: CONFIG, PHASES: PHASES, pause: pauseGame, resume: resumeGame };
})();
