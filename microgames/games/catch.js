/* =========================================================
 * microgames/games/catch.js — Fruit Catch
 * Drag the basket left / right (anywhere on the screen, or arrow keys).
 * Catch fruit: +10. Catch a bomb: -20 and the screen shakes.
 * Things fall faster and more often as the clock runs down.
 * ========================================================= */
(function () {
  'use strict';

  var CFG = {
    POINTS: 10,
    BOMB_PENALTY: -20,
    BOMB_CHANCE: 0.2,
    SPAWN_START: 0.8,   // seconds between drops at the start...
    SPAWN_END: 0.38,    // ...and at the end
    FALL_START: 170,    // px/s on a 700px tall play area (scaled to screen)
    FALL_END: 400,
    KEY_SPEED: 700      // basket speed with arrow keys (px/s)
  };
  var FRUITS = ['🍎', '🍌', '🍎', '🍌', '🍊', '🍓'];

  var e, view, items, basket, targetX, keys, spawnIn, squash;

  function size() {
    return Math.max(34, Math.min(48, view.w * 0.11)); // item size in px
  }

  function spawn() {
    var s = size();
    var bomb = Math.random() < CFG.BOMB_CHANCE;
    items.push({
      x: s / 2 + Math.random() * (view.w - s),
      y: -s,
      bomb: bomb,
      emoji: bomb ? '' : FRUITS[(Math.random() * FRUITS.length) | 0],
      spin: (Math.random() - 0.5) * 3,
      angle: 0
    });
  }

  /* Bombs are drawn by hand: the emoji looks different on every platform
   * (a purple ball on Windows), and a bomb has to read instantly */
  function drawBomb(ctx, s, time) {
    var r = s * 0.38;
    ctx.fillStyle = '#2d3436';
    ctx.beginPath();
    ctx.arc(0, r * 0.15, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.2, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#50555e';
    ctx.fillRect(-r * 0.25, -r * 1.05, r * 0.5, r * 0.3); // cap
    ctx.strokeStyle = '#a0784a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.05);
    ctx.quadraticCurveTo(r * 0.4, -r * 1.5, r * 0.7, -r * 1.3);
    ctx.stroke();
    ctx.fillStyle = Math.sin(time * 30) > 0 ? '#ffca3a' : '#ff595e'; // flickering spark
    ctx.beginPath();
    ctx.arc(r * 0.72, -r * 1.32, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function pointerX(ev) {
    return ev.clientX - view.canvas.getBoundingClientRect().left;
  }

  MicroEngine.register({
    id: 'catch',
    name: 'Fruit Catch',
    hint: 'Drag to catch!',
    icon: '🧺',

    init: function (engine) {
      e = engine;
      view = engine.createCanvas();
      items = [];
      spawnIn = 0.3;
      squash = 0;
      keys = { left: false, right: false };
      basket = { x: view.w / 2, w: Math.max(96, Math.min(150, view.w * 0.28)), h: 46 };
      targetX = basket.x;

      // Drag anywhere: the basket follows your finger horizontally
      var dragging = false;
      engine.on(view.canvas, 'pointerdown', function (ev) {
        dragging = true;
        targetX = pointerX(ev);
        if (view.canvas.setPointerCapture) view.canvas.setPointerCapture(ev.pointerId);
      });
      engine.on(view.canvas, 'pointermove', function (ev) {
        if (dragging || ev.pointerType === 'mouse') targetX = pointerX(ev);
      });
      engine.on(window, 'pointerup', function () { dragging = false; });
      engine.on(window, 'keydown', function (ev) {
        if (ev.key === 'ArrowLeft' || ev.key === 'a') keys.left = true;
        if (ev.key === 'ArrowRight' || ev.key === 'd') keys.right = true;
      });
      engine.on(window, 'keyup', function (ev) {
        if (ev.key === 'ArrowLeft' || ev.key === 'a') keys.left = false;
        if (ev.key === 'ArrowRight' || ev.key === 'd') keys.right = false;
      });
    },

    update: function (dt) {
      var t = e.elapsed / e.duration;
      var w = view.w, h = view.h, s = size();
      var scale = h / 700;

      // Basket movement
      if (keys.left) targetX -= CFG.KEY_SPEED * dt;
      if (keys.right) targetX += CFG.KEY_SPEED * dt;
      var half = basket.w / 2;
      targetX = Math.max(half, Math.min(w - half, targetX));
      basket.x += (targetX - basket.x) * Math.min(1, dt * 22);
      var top = h - 24 - basket.h;  // basket rim
      squash = Math.max(0, squash - dt * 4);

      // Spawning and falling
      spawnIn -= dt;
      if (spawnIn <= 0 && dt > 0) {
        spawn();
        spawnIn = CFG.SPAWN_START + (CFG.SPAWN_END - CFG.SPAWN_START) * t;
      }
      var fall = (CFG.FALL_START + (CFG.FALL_END - CFG.FALL_START) * t) * scale;
      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        var prevY = it.y;
        it.y += fall * dt;
        it.angle += it.spin * dt;
        // Caught: the item's bottom crossed the rim this frame, inside the basket
        var bottom = it.y + s / 2;
        if (prevY + s / 2 < top && bottom >= top && Math.abs(it.x - basket.x) < half + s * 0.2) {
          items.splice(i, 1);
          squash = 1;
          if (it.bomb) {
            e.addScore(CFG.BOMB_PENALTY);
            e.popText(it.x, top - 20, String(CFG.BOMB_PENALTY), 'bad');
            e.shake();
            e.sound('bomb');
          } else {
            e.addScore(CFG.POINTS);
            e.popText(it.x, top - 20, '+' + CFG.POINTS, 'good');
            e.sound('collect');
          }
        } else if (it.y - s > h) {
          items.splice(i, 1); // missed: no penalty
        }
      }

      // Draw: orchard backdrop
      var ctx = view.ctx;
      var sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#bfe9ff');
      sky.addColorStop(1, '#f2fbe9');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#7ccf5b';
      ctx.fillRect(0, h - 24, w, 24);

      // Items
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = s + 'px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      items.forEach(function (it) {
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.rotate(it.angle);
        if (it.bomb) drawBomb(ctx, s, e.elapsed);
        else ctx.fillText(it.emoji, 0, 0);
        ctx.restore();
      });

      // Basket (woven trapezoid), squashes a little on every catch
      var bw = basket.w * (1 + squash * 0.08), bh = basket.h * (1 - squash * 0.15);
      var bx = basket.x - bw / 2, by = h - 24 - bh;
      ctx.fillStyle = '#c8873a';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw * 0.88, by + bh);
      ctx.lineTo(bx + bw * 0.12, by + bh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 2;
      for (var k = 1; k < 3; k++) {
        var yy = by + (bh * k) / 3;
        ctx.beginPath();
        ctx.moveTo(bx + bw * 0.04 * k, yy);
        ctx.lineTo(bx + bw - bw * 0.04 * k, yy);
        ctx.stroke();
      }
      ctx.fillStyle = '#a8692a';
      ctx.fillRect(bx - 4, by - 6, bw + 8, 10); // rim
    },

    // Read-only peek for automated tests
    get state() { return { items: items, basket: basket }; },

    destroy: function () {
      items = null;
      view = e = null;
    }
  });
})();
