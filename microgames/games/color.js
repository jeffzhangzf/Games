/* =========================================================
 * microgames/games/color.js — Color Rush
 * A color word flashes at the top; tap the tile of THAT color.
 * Right: +10. Wrong: -10 and the screen shakes. Let a word run out: no
 * penalty, a new one appears.
 * It gets harder as the clock runs down:
 *   - each word gives you less time (WORD_TIME_START -> WORD_TIME_END)
 *   - tiles start shuffling after every hit (from SHUFFLE_FROM)
 *   - the word's ink starts lying, e.g. "BLUE" painted red (from TRICK_FROM)
 *   - two more colors join the board (from SIX_FROM)
 * Progress points are fractions of this segment's duration, so it plays the
 * same in a 60s round and a 20s challenge slot.
 * ========================================================= */
(function () {
  'use strict';

  var CFG = {
    POINTS: 10,
    WRONG_PENALTY: -10,
    WORD_TIME_START: 2.6,  // seconds to answer at the start...
    WORD_TIME_END: 1.2,    // ...and at the end
    SHUFFLE_FROM: 0.2,
    TRICK_FROM: 0.3,
    TRICK_CHANCE: 0.6,     // once tricks start, this share of words lie
    SIX_FROM: 0.5,
    FEEDBACK: 0.25         // seconds a tile flashes after a tap
  };
  var COLORS = [
    { name: 'RED', fill: '#ff595e' },
    { name: 'BLUE', fill: '#1982c4' },
    { name: 'GREEN', fill: '#43aa5b' },
    { name: 'YELLOW', fill: '#ffc233' },
    { name: 'PURPLE', fill: '#8e5bd6' },
    { name: 'ORANGE', fill: '#ff8c3a' }
  ];

  var e, view, tiles, word, ink, wordLeft, wordTime, flashes, wordPop;

  function progress() {
    return e.duration ? e.elapsed / e.duration : 0;
  }

  function activeCount() {
    return progress() >= CFG.SIX_FROM ? 6 : 4;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Tile order on the board (indexes into COLORS) */
  function deal(n, mix) {
    var ids = [];
    for (var i = 0; i < n; i++) ids.push(i);
    tiles = (mix ? shuffle(ids) : ids).map(function (c) { return { color: c }; });
    layout();
  }

  function layout() {
    var n = tiles.length;
    var cols = 2, rows = n / cols;
    var top = view.h * 0.36, pad = 14;
    var areaW = Math.min(view.w - pad * 2, 520), areaH = view.h - top - pad;
    var gap = 12;
    var tw = (areaW - gap * (cols - 1)) / cols;
    var th = Math.min((areaH - gap * (rows - 1)) / rows, tw * 0.9);
    var x0 = (view.w - areaW) / 2;
    var y0 = top + (areaH - (th * rows + gap * (rows - 1))) / 2;
    tiles.forEach(function (t, i) {
      t.x = x0 + (i % cols) * (tw + gap);
      t.y = y0 + Math.floor(i / cols) * (th + gap);
      t.w = tw;
      t.h = th;
    });
  }

  function nextWord() {
    var p = progress();
    var n = activeCount();
    if (tiles.length !== n) deal(n, true);
    var prev = word;
    do { word = (Math.random() * n) | 0; } while (word === prev && n > 1);
    ink = word;
    if (p >= CFG.TRICK_FROM && Math.random() < CFG.TRICK_CHANCE) {
      do { ink = (Math.random() * n) | 0; } while (ink === word);
    }
    wordTime = CFG.WORD_TIME_START + (CFG.WORD_TIME_END - CFG.WORD_TIME_START) * p;
    wordLeft = wordTime;
    wordPop = 0;
  }

  function onTap(ev) {
    var rect = view.canvas.getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (x < t.x || x > t.x + t.w || y < t.y || y > t.y + t.h) continue;
      var good = t.color === word;
      flashes.push({ tile: t, good: good, age: 0 });
      if (good) {
        e.addScore(CFG.POINTS);
        e.popText(t.x + t.w / 2, t.y + t.h / 2, '+' + CFG.POINTS, 'good');
        e.sound('collect');
        if (progress() >= CFG.SHUFFLE_FROM) deal(tiles.length, true);
        nextWord();
      } else {
        e.addScore(CFG.WRONG_PENALTY);
        e.popText(t.x + t.w / 2, t.y + t.h / 2, String(CFG.WRONG_PENALTY), 'bad');
        e.sound('wrong');
        e.shake();
      }
      return;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  MicroEngine.register({
    id: 'color',
    name: 'Color Rush',
    hint: 'Tap the color you read!',
    icon: '🎨',

    init: function (engine) {
      e = engine;
      view = engine.createCanvas();
      flashes = [];
      word = -1;
      deal(4, false);
      nextWord();
      engine.on(window, 'resize', layout);
      engine.on(view.canvas, 'pointerdown', onTap);
    },

    update: function (dt) {
      // Word timer: running out just moves on (no penalty)
      if (dt > 0) {
        wordLeft -= dt;
        wordPop = Math.min(1, wordPop + dt * 6);
        if (wordLeft <= 0) nextWord();
      }
      flashes.forEach(function (f) { f.age += dt; });
      flashes = flashes.filter(function (f) { return f.age < CFG.FEEDBACK; });

      var ctx = view.ctx, w = view.w, h = view.h;
      ctx.fillStyle = '#f4f1fb';
      ctx.fillRect(0, 0, w, h);

      // Word card
      var cardW = Math.min(w - 40, 420), cardH = h * 0.22;
      var cx = (w - cardW) / 2, cy = h * 0.06;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.08)';
      ctx.shadowBlur = 16;
      roundRect(ctx, cx, cy, cardW, cardH, 20);
      ctx.fill();
      ctx.shadowBlur = 0;

      var scale = 0.7 + 0.3 * (1 - Math.pow(1 - wordPop, 3)); // pop in
      var size = Math.min(cardH * 0.5, cardW / 5.2) * scale;
      ctx.font = '900 ' + Math.round(size) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS[ink].fill;
      ctx.fillText(COLORS[word].name, w / 2, cy + cardH * 0.46);

      // Time left for this word
      var barW = cardW - 40, k = Math.max(0, wordLeft / wordTime);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      roundRect(ctx, cx + 20, cy + cardH - 18, barW, 6, 3);
      ctx.fill();
      ctx.fillStyle = k < 0.3 ? '#e74c3c' : '#8e5bd6';
      roundRect(ctx, cx + 20, cy + cardH - 18, Math.max(6, barW * k), 6, 3);
      ctx.fill();

      // Tiles
      tiles.forEach(function (t) {
        var f = flashes.filter(function (fl) { return fl.tile === t; })[0];
        var press = f ? 1 - f.age / CFG.FEEDBACK : 0;
        var inset = press * 6;
        ctx.fillStyle = COLORS[t.color].fill;
        roundRect(ctx, t.x + inset, t.y + inset, t.w - inset * 2, t.h - inset * 2, 18);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; // soft top shine
        roundRect(ctx, t.x + inset + 8, t.y + inset + 8, t.w - inset * 2 - 16, (t.h - inset * 2) * 0.28, 12);
        ctx.fill();
        if (f) {
          ctx.lineWidth = 6;
          ctx.strokeStyle = f.good ? 'rgba(255,255,255,' + press + ')' : 'rgba(45,52,54,' + press + ')';
          roundRect(ctx, t.x + 3, t.y + 3, t.w - 6, t.h - 6, 18);
          ctx.stroke();
        }
      });
    },

    // Read-only peek for automated tests
    get state() { return { tiles: tiles, word: word, ink: ink, colors: COLORS }; },

    destroy: function () {
      tiles = flashes = null;
      view = e = null;
    }
  });
})();
