/* =========================================================
 * microgames/games/whack.js — Whack-a-Mole
 * 3x3 holes. Moles pop up for about a second (less as time runs out).
 * Tap a mole: +10. Tap an empty hole or a cactus: -10.
 * ========================================================= */
(function () {
  'use strict';

  var CFG = {
    POINTS: 10,
    MISS_PENALTY: -10,
    CACTUS_CHANCE: 0.2,
    UP_START: 1.0,       // seconds a mole stays up at the start...
    UP_END: 0.55,        // ...and at the end
    SPAWN_START: 0.75,   // seconds between pop-ups at the start...
    SPAWN_END: 0.35,     // ...and at the end
    MAX_UP: 3,           // never more than this many things up at once
    RISE: 0.12           // pop-up / duck-down animation time (s)
  };

  var e, view, holes, spawnIn, effects;

  /* Grid geometry: square cells centred in the play area */
  function layout() {
    // Columns fill the width; on tall (portrait) screens rows spread out too
    var cellW = Math.min(view.w * 0.94, view.h * 0.78) / 3;
    var cellH = Math.min(cellW * 1.45, view.h * 0.86 / 3);
    var x0 = (view.w - cellW * 3) / 2, y0 = (view.h - cellH * 3) / 2;
    holes.forEach(function (h, i) {
      h.cx = x0 + cellW * (i % 3 + 0.5);
      h.cy = y0 + cellH * (Math.floor(i / 3) + 0.62);
      h.r = cellW * 0.38;       // hole radius (>= 44px wide on phones)
    });
  }

  function popUp() {
    var t = e.elapsed / e.duration;
    var free = holes.filter(function (h) { return !h.kind; });
    var up = holes.length - free.length;
    if (!free.length || up >= CFG.MAX_UP) return;
    var h = free[(Math.random() * free.length) | 0];
    h.kind = Math.random() < CFG.CACTUS_CHANCE ? 'cactus' : 'mole';
    h.age = 0;
    h.life = CFG.UP_START + (CFG.UP_END - CFG.UP_START) * t;
    h.hit = false;
  }

  /* 0..1 how far out of the hole it is (pops up, stays, ducks down) */
  function rise(h) {
    if (h.hit) return Math.max(0, 1 - h.age / CFG.RISE);
    var a = Math.min(1, h.age / CFG.RISE);
    var b = Math.min(1, (h.life - h.age) / CFG.RISE);
    return Math.max(0, Math.min(a, b));
  }

  function onTap(ev) {
    var rect = view.canvas.getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      // Tap area: the hole plus the space the mole pops up into
      var dx = (x - h.cx) / (h.r * 1.15), dy = (y - (h.cy - h.r * 0.55)) / (h.r * 1.5);
      if (dx * dx + dy * dy > 1) continue;
      effects.push({ x: x, y: y, age: 0 });
      if (h.kind === 'mole' && !h.hit && rise(h) > 0.3) {
        h.hit = true;
        h.age = 0;
        e.addScore(CFG.POINTS);
        e.popText(h.cx, h.cy - h.r * 1.4, '+' + CFG.POINTS, 'good');
        e.sound('capture');
      } else if (!(h.kind === 'mole' && h.hit)) { // re-tapping a bonked mole is free
        e.addScore(CFG.MISS_PENALTY);
        e.popText(h.cx, h.cy - h.r * 1.4, String(CFG.MISS_PENALTY), 'bad');
        e.sound('wrong');
        if (h.kind === 'cactus') e.shake();
      }
      return;
    }
  }

  function drawMole(ctx, h, k) {
    var r = h.r * 0.8;
    var x = h.cx, y = h.cy + r * 1.1 - k * r * 1.6;
    ctx.fillStyle = '#8b5a3c';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9a77c'; // belly / muzzle
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.35, r * 0.55, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (h.hit) { // dizzy eyes
      ctx.strokeStyle = '#2d3436';
      ctx.lineWidth = 3;
      [-1, 1].forEach(function (s) {
        var ex = x + s * r * 0.35, ey = y - r * 0.2, d = r * 0.12;
        ctx.beginPath();
        ctx.moveTo(ex - d, ey - d); ctx.lineTo(ex + d, ey + d);
        ctx.moveTo(ex + d, ey - d); ctx.lineTo(ex - d, ey + d);
        ctx.stroke();
      });
    } else {
      ctx.fillStyle = '#2d3436';
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.arc(x + s * r * 0.35, y - r * 0.2, r * 0.11, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.fillStyle = '#ff7a9a'; // nose
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.12, r * 0.16, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCactus(ctx, h, k) {
    var r = h.r * 0.8;
    var x = h.cx, base = h.cy + r * 1.2 - k * r * 1.7;
    // Upright column with a rounded top
    var pillar = function (x0, y0, w, hh) {
      ctx.beginPath();
      ctx.moveTo(x0, y0 + w / 2);
      ctx.arc(x0 + w / 2, y0 + w / 2, w / 2, Math.PI, 0);
      ctx.lineTo(x0 + w, y0 + hh);
      ctx.lineTo(x0, y0 + hh);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    ctx.fillStyle = '#3fae5a';
    ctx.strokeStyle = '#2b8a43';
    ctx.lineWidth = 3;
    var tw = r * 0.62, aw = r * 0.34;
    // Arms: an elbow from the trunk, then a column going up
    ctx.fillRect(x - r * 0.85, base - r * 0.45, r * 0.6, aw);                 // left elbow
    pillar(x - r * 0.95, base - r * 1.05, aw, r * 0.6 + aw);                   // left arm
    ctx.fillRect(x + r * 0.25, base - r * 0.75, r * 0.6, aw);                 // right elbow
    pillar(x + r * 0.6, base - r * 1.35, aw, r * 0.6 + aw);                    // right arm
    pillar(x - tw / 2, base - r * 1.6, tw, r * 2.4);                           // trunk
    ctx.fillStyle = '#fff';
    for (var i = 0; i < 6; i++) { // spines
      ctx.fillRect(x - tw * 0.25 + (i % 2) * tw * 0.4, base - r * 1.3 + i * r * 0.3, 2, 6);
    }
  }

  MicroEngine.register({
    id: 'whack',
    name: 'Whack-a-Mole',
    hint: 'Tap the moles!',
    icon: '🔨',

    init: function (engine) {
      e = engine;
      view = engine.createCanvas();
      holes = [];
      for (var i = 0; i < 9; i++) holes.push({ kind: null, age: 0, life: 0, hit: false });
      effects = [];
      spawnIn = 0.2;
      layout();
      engine.on(window, 'resize', layout);
      engine.on(view.canvas, 'pointerdown', onTap);
    },

    update: function (dt) {
      var t = e.elapsed / e.duration;
      spawnIn -= dt;
      if (spawnIn <= 0 && dt > 0) {
        popUp();
        spawnIn = CFG.SPAWN_START + (CFG.SPAWN_END - CFG.SPAWN_START) * t;
      }
      holes.forEach(function (h) {
        if (!h.kind) return;
        h.age += dt;
        if ((h.hit && h.age > CFG.RISE) || (!h.hit && h.age > h.life)) h.kind = null;
      });
      effects.forEach(function (f) { f.age += dt; });
      effects = effects.filter(function (f) { return f.age < 0.25; });

      // Draw
      var ctx = view.ctx, w = view.w, hgt = view.h;
      ctx.fillStyle = '#8fd16a';
      ctx.fillRect(0, 0, w, hgt);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; // grass stripes
      for (var s = 0; s < hgt; s += 60) ctx.fillRect(0, s, w, 30);

      holes.forEach(function (h) {
        // Hole (back half)
        ctx.fillStyle = '#5b3a24';
        ctx.beginPath();
        ctx.ellipse(h.cx, h.cy, h.r, h.r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3b2416';
        ctx.beginPath();
        ctx.ellipse(h.cx, h.cy + h.r * 0.05, h.r * 0.85, h.r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();

        // Whatever is popping up, clipped so it seems to come out of the hole
        if (h.kind) {
          var k = rise(h);
          ctx.save();
          ctx.beginPath();
          ctx.rect(h.cx - h.r * 1.5, h.cy - h.r * 3, h.r * 3, h.r * 3);
          ctx.ellipse(h.cx, h.cy, h.r, h.r * 0.42, 0, 0, Math.PI);
          ctx.clip();
          if (h.kind === 'mole') drawMole(ctx, h, k);
          else drawCactus(ctx, h, k);
          ctx.restore();
        }

        // Front lip of the hole
        ctx.strokeStyle = '#7a4e2f';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(h.cx, h.cy, h.r, h.r * 0.42, 0, 0, Math.PI);
        ctx.stroke();
      });

      // Tap ring
      effects.forEach(function (f) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (1 - f.age / 0.25) + ')';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 14 + f.age * 120, 0, Math.PI * 2);
        ctx.stroke();
      });
    },

    // Read-only peek for automated tests
    get state() { return { holes: holes }; },

    destroy: function () {
      holes = effects = null;
      view = e = null;
    }
  });
})();
