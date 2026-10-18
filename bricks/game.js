/* =========================================================
 * bricks/game.js — Brick Builder game logic
 *
 * Purpose: level select page, grid rendering (Canvas), drag & snap,
 *          placement checks, rotation, undo, hints (with a solver),
 *          par timer, results and the 3-star economy.
 *
 * The puzzle: recreate the blueprint picture with the bricks in the tray.
 * A brick may go anywhere its every square lands on the same color in the
 * picture; any layout that fills the picture wins.
 *
 * Depends on (loaded before this file):
 *   ../shared/analytics.js  trackEvent
 *   ../shared/ads.js        showInterstitial / showRewarded / showBanner
 *   ../shared/sound.js      Sound.play / Sound.toggle
 *   models.js               window.BricksModels
 *   levels.js               window.BricksLevels
 *
 * Sections:
 *   1. Storage & progress state
 *   2. Packs, unlocks, par time
 *   3. Renderer (Canvas, shared by thumbnails / blueprint / build grid / results)
 *   4. Small UI helpers (screens, toast, mute, modals)
 *   5. Home screen (level select)
 *   6. Build screen
 *      6a setup & layout   6b tray         6c board state & undo
 *      6d rendering        6e drag & drop  6f timer & HUD
 *      6g hints & solver   6h finish & leave
 *   7. Results screen & star economy
 *   8. Startup
 * ========================================================= */

(function () {
  'use strict';

  var Models = window.BricksModels;
  var Levels = window.BricksLevels;

  function $(id) {
    return document.getElementById(id);
  }

  // trackEvent comes from shared/analytics.js; never let a missing file break the game
  function track(name, params) {
    if (typeof window.trackEvent === 'function') window.trackEvent(name, params);
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60);
  }

  /* =========================================================
   * 1. Storage & progress state
   * ========================================================= */

  // localStorage keys (all prefixed bricks_)
  var KEYS = {
    STARS: 'bricks_stars',                   // number: total stars earned
    COMPLETED: 'bricks_completed',           // JSON array of model ids built at least once
    BEST: 'bricks_best',                     // JSON object { modelId: best stars 1-3 }
    UNLOCKED_PACKS: 'bricks_unlocked_packs', // JSON array of pack ids
    TUTORIAL_SEEN: 'bricks_tutorial_seen',   // 1 once the welcome popup was dismissed
    TIPS_SEEN: 'bricks_tips_seen'            // JSON array of pack ids whose rules tip was shown
  };

  // Storage can throw in private mode / blocked storage, so every access is guarded
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignore */
    }
  }

  // Hand-edited or corrupted storage should not crash the page
  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function asObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  var state = {
    stars: Math.max(0, parseInt(load(KEYS.STARS, 0), 10) || 0),
    completed: asArray(load(KEYS.COMPLETED, [])),
    best: asObject(load(KEYS.BEST, {})),
    unlockedPacks: asArray(load(KEYS.UNLOCKED_PACKS, [])),
    tutorialSeen: load(KEYS.TUTORIAL_SEEN, 0) === 1,
    tipsSeen: asArray(load(KEYS.TIPS_SEEN, []))
  };

  function isCompleted(modelId) {
    return state.completed.indexOf(modelId) !== -1;
  }

  function bestStars(modelId) {
    return Math.min(3, Math.max(0, parseInt(state.best[modelId], 10) || 0));
  }

  /* =========================================================
   * 2. Packs, unlocks, par time
   *    A pack is open when the player's total stars reach requiredStars.
   *    Once open it is written to bricks_unlocked_packs and stays open,
   *    even if requiredStars is raised in a later update.
   * ========================================================= */

  function isPackUnlocked(pack) {
    return state.stars >= pack.requiredStars || state.unlockedPacks.indexOf(pack.id) !== -1;
  }

  /**
   * Record every pack the current star total has reached.
   * @returns {object[]} packs that were newly unlocked by this call (for the results popup)
   */
  function syncUnlockedPacks() {
    var fresh = [];
    Levels.packs.forEach(function (pack) {
      if (state.unlockedPacks.indexOf(pack.id) === -1 && state.stars >= pack.requiredStars) {
        state.unlockedPacks.push(pack.id);
        fresh.push(pack);
      }
    });
    if (fresh.length) save(KEYS.UNLOCKED_PACKS, state.unlockedPacks);
    return fresh;
  }

  function packOf(modelId) {
    for (var i = 0; i < Levels.packs.length; i++) {
      if (Levels.packs[i].models.indexOf(modelId) !== -1) return Levels.packs[i];
    }
    return Levels.packs[0];
  }

  /** Par time in seconds: the model's own `par`, else pack seconds-per-brick x bricks (rounded up to 5 s). */
  function parFor(model, pack) {
    if (model.par) return model.par;
    var sec = model.bricks.length * (pack.rules.parPerBrick || 10);
    return Math.max(30, Math.ceil(sec / 5) * 5);
  }

  /** The model after this one in pack order, if its pack is unlocked; else null. */
  function nextModel(modelId) {
    var order = [];
    Levels.packs.forEach(function (p) {
      p.models.forEach(function (id) { if (Models.byId[id]) order.push({ id: id, pack: p }); });
    });
    for (var i = 0; i < order.length - 1; i++) {
      if (order[i].id === modelId) return isPackUnlocked(order[i + 1].pack) ? Models.byId[order[i + 1].id] : null;
    }
    return null;
  }

  /* =========================================================
   * 3. Renderer
   *    Bricks are flat top-down tiles: colored cells, a darker outline
   *    around the brick's outer edge (so neighbouring bricks of the same
   *    color still read as separate pieces) and a round stud per cell.
   *    The blueprint / thumbnails are drawn as plain pixel art instead,
   *    so they never give away how the picture splits into bricks.
   * ========================================================= */

  /**
   * Size a canvas for crisp drawing on high-DPI screens.
   * @returns {CanvasRenderingContext2D} context already scaled to CSS pixels
   */
  function setupCanvas(canvas, cssW, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /**
   * Add a brick's outer edges (the ones not shared with its own cells) to the current path.
   * Works for any shape. `inset` pulls the lines inward, e.g. half a line width.
   */
  function addOuterEdges(ctx, b, cell, ox, oy, inset) {
    var cells = Models.brickCells(b);
    var own = {};
    cells.forEach(function (c) { own[c[0] + ',' + c[1]] = true; });
    var h = inset;
    cells.forEach(function (c) {
      var x0 = ox + (b.x + c[0]) * cell;
      var y0 = oy + (b.y + c[1]) * cell;
      var x1 = x0 + cell;
      var y1 = y0 + cell;
      if (!own[c[0] + ',' + (c[1] - 1)]) { ctx.moveTo(x0 + h, y0 + h); ctx.lineTo(x1 - h, y0 + h); }
      if (!own[c[0] + ',' + (c[1] + 1)]) { ctx.moveTo(x0 + h, y1 - h); ctx.lineTo(x1 - h, y1 - h); }
      if (!own[(c[0] - 1) + ',' + c[1]]) { ctx.moveTo(x0 + h, y0 + h); ctx.lineTo(x0 + h, y1 - h); }
      if (!own[(c[0] + 1) + ',' + c[1]]) { ctx.moveTo(x1 - h, y0 + h); ctx.lineTo(x1 - h, y1 - h); }
    });
  }

  /**
   * Draw one brick.
   * @param {object} b      brick { x, y, color, shape + rot | cells }
   * @param {number} cell   cell size in CSS px
   * @param {number} ox/oy  grid origin in CSS px
   * @param {boolean} studs draw round studs (off for small sizes, where they're just noise)
   */
  function drawBrick(ctx, b, cell, ox, oy, studs) {
    var col = Models.COLORS[b.color];
    var cells = Models.brickCells(b);

    ctx.fillStyle = col.fill;
    cells.forEach(function (c) {
      ctx.fillRect(ox + (b.x + c[0]) * cell, oy + (b.y + c[1]) * cell, cell, cell);
    });

    var lw = Math.max(1, cell * 0.08);
    ctx.strokeStyle = col.edge;
    ctx.lineWidth = lw;
    ctx.lineCap = 'square';
    ctx.beginPath();
    addOuterEdges(ctx, b, cell, ox, oy, lw / 2);
    ctx.stroke();

    if (studs) {
      var r = cell * 0.26;
      cells.forEach(function (c) {
        var cx = ox + (b.x + c[0] + 0.5) * cell;
        var cy = oy + (b.y + c[1] + 0.5) * cell;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = col.fill;
        ctx.fill();
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.strokeStyle = col.edge;
        ctx.stroke();
        // small highlight so the stud looks raised
        ctx.beginPath();
        ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fill();
      });
    }
  }

  /** Light grid background with thin cell lines. */
  function drawGridBackground(ctx, gw, gh, cell, ox, oy) {
    ctx.fillStyle = '#e9eef4';
    ctx.fillRect(ox, oy, gw * cell, gh * cell);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 1; x < gw; x++) {
      ctx.moveTo(ox + x * cell + 0.5, oy);
      ctx.lineTo(ox + x * cell + 0.5, oy + gh * cell);
    }
    for (var y = 1; y < gh; y++) {
      ctx.moveTo(ox, oy + y * cell + 0.5);
      ctx.lineTo(ox + gw * cell, oy + y * cell + 0.5);
    }
    ctx.stroke();
  }

  /** The picture as a 2D array of color names (null = empty), built from the model's bricks. */
  function targetOf(model) {
    var t = [];
    for (var y = 0; y < model.gridSize.h; y++) {
      t.push([]);
      for (var x = 0; x < model.gridSize.w; x++) t[y].push(null);
    }
    model.bricks.forEach(function (b) {
      Models.brickCells(b).forEach(function (c) { t[b.y + c[1]][b.x + c[0]] = b.color; });
    });
    return t;
  }

  var targetCache = {};
  function cachedTarget(model) {
    if (!targetCache[model.id]) targetCache[model.id] = targetOf(model);
    return targetCache[model.id];
  }

  /**
   * Draw the model as pixel art, centered in a square canvas (thumbnails, blueprint, zoom).
   * Cell lines are drawn on top when cells are big enough, to help counting squares.
   */
  function drawPicture(canvas, model, size) {
    var ctx = setupCanvas(canvas, size, size);
    var gw = model.gridSize.w;
    var gh = model.gridSize.h;
    var cell = Math.floor(size / Math.max(gw, gh));
    var ox = Math.floor((size - gw * cell) / 2);
    var oy = Math.floor((size - gh * cell) / 2);
    var t = cachedTarget(model);
    ctx.clearRect(0, 0, size, size);
    // Darker than the build grid so white squares still stand out
    ctx.fillStyle = '#d5dde6';
    ctx.fillRect(ox, oy, gw * cell, gh * cell);
    for (var y = 0; y < gh; y++) {
      for (var x = 0; x < gw; x++) {
        if (!t[y][x]) continue;
        ctx.fillStyle = Models.COLORS[t[y][x]].fill;
        ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      }
    }
    if (cell >= 6) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var gx = 0; gx <= gw; gx++) {
        ctx.moveTo(ox + gx * cell + 0.5, oy);
        ctx.lineTo(ox + gx * cell + 0.5, oy + gh * cell);
      }
      for (var gy = 0; gy <= gh; gy++) {
        ctx.moveTo(ox, oy + gy * cell + 0.5);
        ctx.lineTo(ox + gw * cell, oy + gy * cell + 0.5);
      }
      ctx.stroke();
    }
  }

  /** Draw a set of placed bricks centered in a square canvas (the player's build on the results screen). */
  function drawBuild(canvas, model, bricks, size) {
    var ctx = setupCanvas(canvas, size, size);
    var gw = model.gridSize.w;
    var gh = model.gridSize.h;
    var cell = Math.floor(size / Math.max(gw, gh));
    var ox = Math.floor((size - gw * cell) / 2);
    var oy = Math.floor((size - gh * cell) / 2);
    ctx.clearRect(0, 0, size, size);
    drawGridBackground(ctx, gw, gh, cell, ox, oy);
    bricks.forEach(function (b) { drawBrick(ctx, b, cell, ox, oy, cell >= 12); });
  }

  /* =========================================================
   * 4. Small UI helpers
   * ========================================================= */

  var screens = {
    home: $('home-screen'),
    build: $('build-screen'),
    result: $('result-screen')
  };

  function showScreen(name) {
    for (var key in screens) screens[key].classList.toggle('hidden', key !== name);
    $('toast').classList.remove('show'); // a tip from the previous screen shouldn't follow along
  }

  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  function playSound(name, params) {
    if (window.Sound) window.Sound.play(name, params);
  }

  function updateMuteUI() {
    $('btn-mute').textContent = window.Sound && window.Sound.isMuted() ? '🔇' : '🔊';
  }

  $('btn-mute').addEventListener('click', function () {
    if (!window.Sound) return;
    window.Sound.toggle();
    updateMuteUI();
    playSound('tap');
  });

  function openModal(id) {
    $(id).classList.remove('hidden');
  }

  function closeModal(id) {
    $(id).classList.add('hidden');
  }

  // Any popup (ours or a mock ad) pauses the par timer
  function anyModalOpen() {
    return !!document.querySelector('.modal:not(.hidden), .mock-ad-mask');
  }

  // Restart a one-shot CSS animation class
  function replayClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the animation runs again
    el.classList.add(cls);
  }

  function starString(n) {
    var s = '';
    for (var i = 0; i < 3; i++) s += i < n ? '★' : '☆';
    return s;
  }

  /* =========================================================
   * 5. Home screen (level select)
   * ========================================================= */

  var packList = $('pack-list');
  var homeStarsShown = null; // star total last time home was drawn, to "bump" it when it grows

  function renderHome() {
    syncUnlockedPacks();
    $('star-count').textContent = state.stars;
    if (homeStarsShown !== null && state.stars > homeStarsShown) replayClass($('star-total'), 'bump');
    homeStarsShown = state.stars;
    packList.innerHTML = '';

    Levels.packs.forEach(function (pack) {
      packList.appendChild(isPackUnlocked(pack) ? buildOpenPack(pack) : buildLockedPack(pack));
    });
    drawThumbnails();
  }

  function buildOpenPack(pack) {
    var el = document.createElement('div');
    el.className = 'pack';
    var ids = pack.models.filter(function (id) { return Models.byId[id]; });
    var got = ids.reduce(function (sum, id) { return sum + bestStars(id); }, 0);
    el.innerHTML =
      '<div class="pack-head">' +
      '  <h2>' + pack.name + '</h2>' +
      '  <span class="pack-meta">' + ids.length + ' models · ' + got + '/' + ids.length * 3 + ' ★</span>' +
      '</div>' +
      '<div class="model-grid"></div>';

    var grid = el.querySelector('.model-grid');
    ids.forEach(function (id) {
      var model = Models.byId[id];
      var best = bestStars(id);
      var tile = document.createElement('button');
      tile.className = 'model-tile';
      tile.setAttribute('data-model', id);
      tile.setAttribute('aria-label', model.name + (isCompleted(id) ? ' (built, ' + best + ' stars)' : ''));
      tile.innerHTML =
        '<canvas></canvas>' +
        '<span class="model-name">' + model.name + '</span>' +
        '<span class="model-stars' + (best ? '' : ' none') + '">' + starString(best) + '</span>' +
        (isCompleted(id) ? '<span class="check" aria-hidden="true">✓</span>' : '');
      tile.addEventListener('click', function () { selectModel(id); });
      grid.appendChild(tile);
    });
    return el;
  }

  function buildLockedPack(pack) {
    var el = document.createElement('div');
    el.className = 'pack locked';
    el.setAttribute('role', 'button');
    var pct = Math.min(100, Math.round((state.stars / pack.requiredStars) * 100));
    el.innerHTML =
      '<div class="pack-head">' +
      '  <h2>' + pack.name + '</h2>' +
      '  <span class="pack-meta">' + pack.models.length + ' models</span>' +
      '</div>' +
      '<div class="lock-body">' +
      '  <div class="lock-icon" aria-hidden="true">🔒</div>' +
      '  <div class="lock-info">' +
      '    <div class="lock-text">Need ' + pack.requiredStars + ' ⭐ to unlock</div>' +
      '    <div class="progress"><div class="bar" style="width:' + pct + '%"></div></div>' +
      '    <div class="progress-label">' + state.stars + ' / ' + pack.requiredStars + ' ⭐</div>' +
      '  </div>' +
      '</div>';
    el.addEventListener('click', function () {
      track('bricks_locked_click', { pack_id: pack.id });
      playSound('deny');
      toast('Collect more stars to unlock!');
    });
    return el;
  }

  // Thumbnails are sized from the real tile width, so they stay sharp on any screen
  function drawThumbnails() {
    var tiles = packList.querySelectorAll('.model-tile');
    for (var i = 0; i < tiles.length; i++) {
      var canvas = tiles[i].querySelector('canvas');
      var size = Math.floor(canvas.parentNode.clientWidth - 8);
      if (size > 0) drawPicture(canvas, Models.byId[tiles[i].getAttribute('data-model')], size);
    }
  }

  function showHome() {
    showScreen('home');
    renderHome();
    track('bricks_home_view');
  }

  function selectModel(id) {
    track('bricks_model_select', { model_id: id });
    playSound('tap');
    openBuild(Models.byId[id]);
  }

  /* ---------------- First-visit welcome ---------------- */

  function maybeShowTutorial() {
    if (state.tutorialSeen) return;
    openModal('tutorial-modal');
  }

  $('btn-tutorial-ok').addEventListener('click', function () {
    state.tutorialSeen = true;
    save(KEYS.TUTORIAL_SEEN, 1);
    closeModal('tutorial-modal');
    playSound('tap');
  });

  /* =========================================================
   * 6. Build screen
   * ========================================================= */

  var HINTS_PER_LEVEL = 3;
  var FLASH_MS = 1800;    // gold glow on a brick placed by a hint
  var POP_MS = 220;       // "pop" animation when a brick lands
  var TOUCH_LIFT = 28;    // on touch, the dragged brick floats this far above the finger so it stays visible
  var SOLVER_BUDGET = 150000; // search steps before the hint solver gives up (keeps the UI responsive)

  var board = $('board');
  var boardCtx = null;
  var tray = $('tray');

  /*
   * level = {
   *   model, pack, rules, par (s),
   *   target: [[color|null]], totalCells, filled,
   *   groups: [ { key, shape, color, orients: [cells, ...], oi, total, left, el, canvas, countEl } ],
   *           one tray card per shape+color (rotating packs) or per exact orientation+color
   *   pieces: [ { id, gi, oi, x, y, cells, color } ]   bricks on the grid
   *   occ: { 'x,y': piece },  history: [action, ...],  nextId,
   *   hintsUsed, flash: { piece, until } | null, pops: { pieceId: startTime },
   *   preview: { x, y, ok } | null,  elapsed (ms), lastTick, done
   * }
   */
  var level = null;

  /* ---------------- 6a. Setup & layout ---------------- */

  // All distinct orientations of a shape (an O4 has 1, an I2 has 2, a T4 has 4)
  function distinctOrients(shape) {
    var seen = {};
    var out = [];
    for (var r = 0; r < 4; r++) {
      var cells = Models.orient(shape, r);
      var key = Models.cellsKey(cells);
      if (!seen[key]) {
        seen[key] = true;
        out.push(cells);
      }
    }
    return out;
  }

  function groupKey(b, rotate) {
    return (rotate ? b.shape : Models.cellsKey(Models.orient(b.shape, b.rot))) + '|' + b.color;
  }

  /** Tray groups from the solution bricks plus decoys. */
  function buildGroups(model, rotate) {
    var groups = [];
    var byKey = {};
    model.bricks.concat(model.decoys || []).forEach(function (b) {
      var key = groupKey(b, rotate);
      if (byKey[key] === undefined) {
        byKey[key] = groups.length;
        groups.push({
          key: key,
          shape: b.shape,
          color: b.color,
          orients: rotate ? distinctOrients(b.shape) : [Models.orient(b.shape, b.rot)],
          oi: 0,
          total: 0,
          left: 0,
          el: null,
          canvas: null,
          countEl: null
        });
      }
      groups[byKey[key]].total++;
      groups[byKey[key]].left++;
    });
    return groups;
  }

  function openBuild(model) {
    closeBuildModals();
    cancelDrag();

    var pack = packOf(model.id);
    var target = cachedTarget(model);
    var total = 0;
    target.forEach(function (row) { row.forEach(function (c) { if (c) total++; }); });

    level = {
      model: model,
      pack: pack,
      rules: pack.rules,
      par: parFor(model, pack),
      target: target,
      totalCells: total,
      filled: 0,
      groups: buildGroups(model, pack.rules.rotate),
      pieces: [],
      occ: {},
      history: [],
      nextId: 1,
      hintsUsed: 0,
      flash: null,
      pops: {},
      preview: null,
      elapsed: 0,
      lastTick: performance.now(),
      cell: 32,
      done: false
    };

    $('build-title').textContent = model.name;
    screens.build.classList.toggle('can-rotate', !!pack.rules.rotate);
    buildTray();
    updateBuildHud(false);
    showScreen('build');
    layoutBuild();
    track('bricks_level_start', { model_id: model.id });
    maybeShowPackTip(pack);
  }

  // Each pack's new rule is explained once, on the first level played in it
  function maybeShowPackTip(pack) {
    if (!pack.tip || state.tipsSeen.indexOf(pack.id) !== -1) return;
    $('tip-title').textContent = pack.tip.title;
    $('tip-text').textContent = pack.tip.text;
    openModal('tip-modal');
  }

  $('btn-tip-ok').addEventListener('click', function () {
    if (level && state.tipsSeen.indexOf(level.pack.id) === -1) {
      state.tipsSeen.push(level.pack.id);
      save(KEYS.TIPS_SEEN, state.tipsSeen);
    }
    closeModal('tip-modal');
    playSound('tap');
  });

  function closeBuildModals() {
    ['hint-modal', 'leave-modal', 'unlock-modal', 'tip-modal', 'zoom-modal'].forEach(closeModal);
  }

  /*
   * Layout: the grid gets as much room as possible (cells >= 32px when the screen
   * allows); the blueprint shrinks first on short screens.
   */
  function layoutBuild() {
    if (!level) return;
    var m = level.model;
    var gw = m.gridSize.w;
    var gh = m.gridSize.h;
    var scr = screens.build;
    var row = scr.querySelector('.blueprint-row');
    var wrapStyle = getComputedStyle($('board-wrap'));
    var boardPad = parseFloat(wrapStyle.paddingTop) + parseFloat(wrapStyle.paddingBottom);
    var fixed = scr.querySelector('.topbar').offsetHeight + tray.offsetHeight + boardPad;
    var widthCell = Math.floor((scr.clientWidth - 24) / gw);
    var bp = 112;
    var cell = 0;

    for (var i = 0; i < 3; i++) {
      drawPicture($('blueprint'), m, bp);
      var avail = scr.clientHeight - fixed - row.offsetHeight;
      cell = Math.min(widthCell, Math.floor(avail / gh), 52);
      if (cell >= 32 || bp <= 64) break;
      bp = Math.max(64, bp - (32 * gh - avail));
    }

    level.cell = Math.max(20, cell);
    boardCtx = setupCanvas(board, gw * level.cell, gh * level.cell);
    requestRender();
  }

  /* ---------------- 6b. Tray ---------------- */

  function buildTray() {
    tray.innerHTML = '';
    tray.scrollLeft = 0;

    // Display order: palette order, bigger bricks first within a color
    var colorOrder = Object.keys(Models.COLORS);
    var order = level.groups.slice().sort(function (a, b) {
      return colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color) ||
        b.orients[0].length - a.orients[0].length;
    });

    order.forEach(function (g) {
      var el = document.createElement('div');
      el.className = 'tray-item';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', g.color + ' ' + g.shape + ' brick');

      var canvas = document.createElement('canvas');
      el.appendChild(canvas);
      if (level.rules.rotate && g.orients.length > 1) {
        var rot = document.createElement('span');
        rot.className = 'rot-badge';
        rot.textContent = '↻';
        el.appendChild(rot);
      }
      var count = document.createElement('span');
      count.className = 'count';
      el.appendChild(count);

      g.el = el;
      g.canvas = canvas;
      g.countEl = count;
      el.addEventListener('pointerdown', function (e) { onTrayPointerDown(e, g); });
      tray.appendChild(el);
      drawTrayItem(g);
      updateTrayItem(g);
    });
  }

  function groupBrick(g, oi) {
    return { x: 0, y: 0, cells: g.orients[oi], color: g.color };
  }

  function cellsSize(cells) {
    var w = 0;
    var h = 0;
    cells.forEach(function (c) { w = Math.max(w, c[0] + 1); h = Math.max(h, c[1] + 1); });
    return { w: w, h: h };
  }

  function drawTrayItem(g) {
    var cells = g.orients[g.oi];
    var s = cellsSize(cells);
    var cell = Math.min(16, Math.floor(58 / Math.max(s.w, s.h)));
    var ctx = setupCanvas(g.canvas, s.w * cell, s.h * cell);
    drawBrick(ctx, groupBrick(g, g.oi), cell, 0, 0, true);
  }

  function updateTrayItem(g) {
    g.countEl.textContent = '×' + g.left;
    g.el.classList.toggle('empty', g.left === 0);
  }

  function rotateGroup(g) {
    if (g.orients.length < 2) return;
    g.oi = (g.oi + 1) % g.orients.length;
    drawTrayItem(g);
    replayClass(g.el, 'spin');
    playSound('tap');
  }

  /* ---------------- 6c. Board state & undo ---------------- */

  function absCells(cells, x, y) {
    return cells.map(function (c) { return [x + c[0], y + c[1]]; });
  }

  /**
   * Can a brick with these cells and color go at (x, y)?
   * @returns {string} 'ok' | 'bounds' | 'overlap' | 'color'
   */
  function checkPlace(cells, color, x, y) {
    var m = level.model;
    var res = 'ok';
    absCells(cells, x, y).some(function (c) {
      if (c[0] < 0 || c[1] < 0 || c[0] >= m.gridSize.w || c[1] >= m.gridSize.h) { res = 'bounds'; return true; }
      if (level.occ[c[0] + ',' + c[1]]) { res = 'overlap'; return true; }
      if (level.target[c[1]][c[0]] !== color) res = 'color'; // keep looking: overlap wins over color
      return false;
    });
    return res;
  }

  function addPiece(p) {
    level.pieces.push(p);
    absCells(p.cells, p.x, p.y).forEach(function (c) { level.occ[c[0] + ',' + c[1]] = p; });
    level.filled += p.cells.length;
    var g = level.groups[p.gi];
    g.left--;
    updateTrayItem(g);
    level.pops[p.id] = performance.now();
  }

  function removePiece(p) {
    var i = level.pieces.indexOf(p);
    if (i === -1) return;
    level.pieces.splice(i, 1);
    absCells(p.cells, p.x, p.y).forEach(function (c) { delete level.occ[c[0] + ',' + c[1]]; });
    level.filled -= p.cells.length;
    var g = level.groups[p.gi];
    g.left++;
    updateTrayItem(g);
    if (level.flash && level.flash.piece === p) level.flash = null;
  }

  function newPiece(gi, oi, x, y) {
    var g = level.groups[gi];
    return { id: level.nextId++, gi: gi, oi: oi, x: x, y: y, cells: g.orients[oi], color: g.color };
  }

  /*
   * History actions (undo pops the last one):
   *   { type: 'place', piece }        brick put on the grid from the tray
   *   { type: 'remove', piece }       brick taken off the grid back to the tray
   *   { type: 'move', from, to }      brick dragged from one spot to another
   *   { type: 'reset', pieces }       "start over" (so it can be undone too)
   * Piece objects are re-used when restored, so older entries stay valid.
   */
  function undo() {
    if (!level || level.done) return;
    var a = level.history.pop();
    if (!a) {
      toast('Nothing to undo');
      return;
    }
    if (a.type === 'place') removePiece(a.piece);
    else if (a.type === 'remove') addPiece(a.piece);
    else if (a.type === 'move') { removePiece(a.to); addPiece(a.from); }
    else if (a.type === 'reset') a.pieces.forEach(addPiece);
    playSound('tap');
    afterBoardChange();
  }

  function resetBoard() {
    if (!level || level.done || !level.pieces.length) return;
    var all = level.pieces.slice();
    all.forEach(removePiece);
    level.history.push({ type: 'reset', pieces: all });
    playSound('wrong');
    toast('Grid cleared — Undo brings it back');
    track('bricks_reset', { model_id: level.model.id });
    afterBoardChange();
  }

  function afterBoardChange() {
    updateBuildHud(false);
    requestRender();
    if (level.filled === level.totalCells) finishLevel();
  }

  $('btn-undo').addEventListener('click', undo);
  $('btn-reset').addEventListener('click', resetBoard);

  /* ---------------- 6d. Rendering (requestAnimationFrame, only while something moves) ---------------- */

  var rafId = 0;
  function requestRender() {
    if (!rafId) rafId = requestAnimationFrame(renderBoard);
  }

  function renderBoard(now) {
    rafId = 0;
    if (!level || !boardCtx) return;
    var m = level.model;
    var gw = m.gridSize.w;
    var gh = m.gridSize.h;
    var cell = level.cell;
    var ctx = boardCtx;
    var busy = false;

    // The grid stays blank apart from placed bricks: no guide of any kind,
    // the blueprint is the only reference (finding positions is part of the puzzle)
    ctx.clearRect(0, 0, gw * cell, gh * cell);
    drawGridBackground(ctx, gw, gh, cell, 0, 0);

    // Placed bricks, with a quick grow-and-settle "pop" right after landing
    level.pieces.forEach(function (p) {
      var t0 = level.pops[p.id];
      var k = t0 ? (now - t0) / POP_MS : 1;
      if (k >= 1) {
        delete level.pops[p.id];
        drawBrick(ctx, p, cell, 0, 0, true);
        return;
      }
      busy = true;
      var s = 1 + 0.14 * Math.sin(Math.max(0, k) * Math.PI);
      var bs = cellsSize(p.cells);
      var cx = (p.x + bs.w / 2) * cell;
      var cy = (p.y + bs.h / 2) * cell;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      drawBrick(ctx, p, cell, 0, 0, true);
      ctx.restore();
    });

    // A brick placed by a hint glows gold for a moment
    if (level.flash) {
      if (now < level.flash.until) {
        busy = true;
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 90);
        ctx.strokeStyle = '#ffb400';
        ctx.lineWidth = 4;
        ctx.beginPath();
        addOuterEdges(ctx, level.flash.piece, cell, 0, 0, 2);
        ctx.stroke();
        ctx.restore();
      } else {
        level.flash = null;
      }
    }

    // Landing preview under the dragged brick: blue = free spot, red = blocked.
    // It never says whether the colors match — reading the blueprint is the player's job.
    if (drag && level.preview) {
      var p = level.preview;
      var pb = { x: p.x, y: p.y, cells: drag.cells };
      ctx.save();
      ctx.fillStyle = p.ok ? 'rgba(52, 152, 219, 0.22)' : 'rgba(231, 76, 60, 0.22)';
      pb.cells.forEach(function (c) {
        ctx.fillRect((pb.x + c[0]) * cell, (pb.y + c[1]) * cell, cell, cell);
      });
      ctx.strokeStyle = p.ok ? '#3498db' : '#e74c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      addOuterEdges(ctx, pb, cell, 0, 0, 1);
      ctx.stroke();
      ctx.restore();
    }

    if (busy) requestRender();
  }

  /* ---------------- 6e. Drag & drop (Pointer Events: mouse, touch and pen) ----------------
   * From the tray:
   *   Touch: the tray scrolls sideways natively (touch-action: pan-x); a drag only
   *          starts when the finger moves UP off a brick card. A tap rotates the
   *          brick (rotating packs).
   *   Mouse: any small movement starts a drag; a click rotates.
   * From the grid: dragging a placed brick moves it; a tap sends it back to the tray.
   * Desktop extras: R rotates the brick being dragged, Ctrl/Cmd+Z undoes.
   */

  var drag = null;     // { gi, oi, cells, color, from (piece picked off the grid) | null, pointerId, ghost, w, h, mouse }
  var pending = null;  // pointer is down on a tray card / placed brick, tap-vs-drag not decided yet

  function onTrayPointerDown(e, g) {
    if (!level || level.done || drag) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      e.preventDefault(); // no text selection / native image drag
    }
    pending = { group: g, pointerId: e.pointerId, x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
  }

  board.addEventListener('pointerdown', function (e) {
    if (!level || level.done || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var r = board.getBoundingClientRect();
    var x = Math.floor((e.clientX - r.left) / level.cell);
    var y = Math.floor((e.clientY - r.top) / level.cell);
    var piece = level.occ[x + ',' + y];
    if (!piece) return;
    e.preventDefault();
    pending = { piece: piece, pointerId: e.pointerId, x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
  });

  window.addEventListener('pointermove', function (e) {
    if (drag) {
      if (e.pointerId === drag.pointerId) moveDrag(e.clientX, e.clientY);
      return;
    }
    if (!pending || e.pointerId !== pending.pointerId) return;
    var dx = e.clientX - pending.x;
    var dy = e.clientY - pending.y;
    var start;
    if (pending.piece) start = Math.abs(dx) + Math.abs(dy) > 6;
    else if (pending.mouse) start = Math.abs(dx) + Math.abs(dy) > 4;
    else start = dy < -8 && Math.abs(dy) > Math.abs(dx);
    if (start) {
      var p = pending;
      pending = null;
      if (p.piece) startBoardDrag(p, e.clientX, e.clientY);
      else if (p.group.left > 0) startTrayDrag(p, e.clientX, e.clientY);
    }
  });

  window.addEventListener('pointerup', function (e) {
    if (pending && e.pointerId === pending.pointerId) {
      var p = pending;
      pending = null;
      onTap(p);
      return;
    }
    if (drag && e.pointerId === drag.pointerId) dropBrick();
  });

  window.addEventListener('pointercancel', function (e) {
    if (pending && e.pointerId === pending.pointerId) pending = null; // the tray took over to scroll
    if (drag && e.pointerId === drag.pointerId) {
      level.preview = null;
      returnToTray(takeDrag(), false);
    }
  });

  // iOS Safari can still scroll the page from touchmove; block it while a brick is in the air
  document.addEventListener('touchmove', function (e) {
    if (drag) e.preventDefault();
  }, { passive: false });

  window.addEventListener('keydown', function (e) {
    if (!level || screens.build.classList.contains('hidden')) return;
    if ((e.key === 'r' || e.key === 'R') && drag && level.rules.rotate) rotateDrag();
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !drag) {
      e.preventDefault();
      undo();
    }
  });

  // A tap (no drag): tray card -> rotate (or explain); placed brick -> back to the tray
  function onTap(p) {
    if (!level || level.done) return;
    if (p.piece) {
      removePiece(p.piece);
      level.history.push({ type: 'remove', piece: p.piece });
      playSound('tap');
      afterBoardChange();
      return;
    }
    if (level.rules.rotate && p.group.orients.length > 1) rotateGroup(p.group);
    else toast(p.mouse ? 'Drag a brick onto the grid!' : 'Drag a brick up onto the grid!');
  }

  function makeGhost(cells, color) {
    var cell = level.cell;
    var s = cellsSize(cells);
    var ghost = document.createElement('canvas');
    ghost.className = 'drag-ghost';
    var ctx = setupCanvas(ghost, s.w * cell, s.h * cell);
    drawBrick(ctx, { x: 0, y: 0, cells: cells, color: color }, cell, 0, 0, true);
    return { el: ghost, w: s.w * cell, h: s.h * cell };
  }

  function startTrayDrag(p, px, py) {
    var g = p.group;
    var gi = level.groups.indexOf(g);
    beginDrag(gi, g.oi, null, p, px, py);
    g.el.classList.add('lifted');
  }

  function startBoardDrag(p, px, py) {
    var piece = p.piece;
    removePiece(piece);
    beginDrag(piece.gi, piece.oi, piece, p, px, py);
    requestRender();
  }

  function beginDrag(gi, oi, fromPiece, p, px, py) {
    var g = level.groups[gi];
    var gh = makeGhost(g.orients[oi], g.color);
    document.body.appendChild(gh.el);
    drag = {
      gi: gi,
      oi: oi,
      cells: g.orients[oi],
      color: g.color,
      from: fromPiece,
      pointerId: p.pointerId,
      ghost: gh.el,
      w: gh.w,
      h: gh.h,
      mouse: p.mouse,
      px: px,
      py: py
    };
    playSound('tap');
    moveDrag(px, py);
  }

  // Desktop: R turns the brick in the air
  function rotateDrag() {
    var g = level.groups[drag.gi];
    if (g.orients.length < 2) return;
    drag.oi = (drag.oi + 1) % g.orients.length;
    drag.cells = g.orients[drag.oi];
    var gh = makeGhost(drag.cells, drag.color);
    drag.ghost.parentNode.replaceChild(gh.el, drag.ghost);
    drag.ghost = gh.el;
    drag.w = gh.w;
    drag.h = gh.h;
    playSound('tap');
    moveDrag(drag.px, drag.py);
  }

  function moveDrag(px, py) {
    // Mouse: brick centered on the cursor. Touch: brick floats above the finger.
    drag.px = px;
    drag.py = py;
    var left = px - drag.w / 2;
    var top = drag.mouse ? py - drag.h / 2 : py - drag.h - TOUCH_LIFT;
    drag.ghost.style.left = left + 'px';
    drag.ghost.style.top = top + 'px';
    level.preview = snapTarget(left, top);
    requestRender();
  }

  /**
   * Grid cell where the dragged brick would land, or null if it isn't over the grid.
   * The brick's top-left corner is converted to grid coordinates and rounded to the
   * nearest cell: col = Math.round((ghostLeft - gridLeft) / cellSize), same for rows.
   */
  function snapTarget(left, top) {
    var r = board.getBoundingClientRect();
    var cell = level.cell;
    var m = level.model;
    var s = cellsSize(drag.cells);

    // Only counts as "over the grid" when the brick's center is on it (half a cell of slack)
    var cx = left + drag.w / 2;
    var cy = top + drag.h / 2;
    var slack = cell / 2;
    if (cx < r.left - slack || cx > r.right + slack || cy < r.top - slack || cy > r.bottom + slack) return null;

    var x = Math.round((left - r.left) / cell);
    var y = Math.round((top - r.top) / cell);
    // Hanging slightly over an edge is forgiven: pull the brick fully inside
    x = Math.max(0, Math.min(m.gridSize.w - s.w, x));
    y = Math.max(0, Math.min(m.gridSize.h - s.h, y));

    var res = checkPlace(drag.cells, drag.color, x, y);
    return { x: x, y: y, ok: res === 'ok' || res === 'color' };
  }

  // Detach the active drag (so a new one can start right away) and hand it back
  function takeDrag() {
    var d = drag;
    drag = null;
    return d;
  }

  function cancelDrag() {
    pending = null;
    if (!drag) return;
    var d = takeDrag();
    if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    level.groups[d.gi].el.classList.remove('lifted');
    // A brick picked off the grid goes back where it was
    if (d.from) addPiece(d.from);
    if (level) level.preview = null;
  }

  function dropBrick() {
    var p = level.preview;
    level.preview = null;
    var d = takeDrag();
    requestRender();

    // Dropped away from the grid: back to the tray, no penalty
    if (!p) {
      returnToTray(d, false);
      return;
    }

    var res = checkPlace(d.cells, d.color, p.x, p.y);
    if (res !== 'ok') {
      track('bricks_place_wrong', { model_id: level.model.id, reason: res });
      returnToTray(d, true);
      return;
    }

    if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    level.groups[d.gi].el.classList.remove('lifted');
    var piece = newPiece(d.gi, d.oi, p.x, p.y);
    addPiece(piece);
    level.history.push(d.from ? { type: 'move', from: d.from, to: piece } : { type: 'place', piece: piece });
    playSound('snap');
    track('bricks_place_correct', { model_id: level.model.id });
    afterBoardChange();
  }

  /**
   * Send a dragged brick back to the tray. A brick that came off the grid counts
   * as removed (undo puts it back). `wrong` adds the shake + error sound.
   */
  function returnToTray(d, wrong) {
    if (d.from) {
      level.history.push({ type: 'remove', piece: d.from });
      afterBoardChange();
    }
    var el = level.groups[d.gi].el;
    if (wrong) {
      playSound('wrong');
      replayClass(d.ghost, 'shake');
      replayClass(el, 'shake');
      setTimeout(function () { flyBack(d); }, 280);
    } else {
      flyBack(d);
    }
  }

  // Animate the floating brick back into its tray card, then remove it
  function flyBack(d) {
    var el = level ? level.groups[d.gi].el : null;
    if (!el) {
      if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      return;
    }
    var r = el.getBoundingClientRect();
    d.ghost.classList.add('returning');
    d.ghost.style.left = (r.left + r.width / 2 - d.w / 2) + 'px';
    d.ghost.style.top = (r.top + r.height / 2 - d.h / 2) + 'px';
    setTimeout(function () {
      if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      el.classList.remove('lifted');
    }, 260);
  }

  /* ---------------- 6f. Timer & HUD ---------------- */

  // The par timer only runs while the player can actually play (no popups, tab visible)
  setInterval(function () {
    if (!level) return;
    var now = performance.now();
    var running = !level.done && !document.hidden && !screens.build.classList.contains('hidden') && !anyModalOpen();
    if (running) level.elapsed += now - level.lastTick;
    level.lastTick = now;
    if (running) updateTimerUI();
  }, 250);

  function elapsedSec() {
    return Math.floor(level.elapsed / 1000);
  }

  function updateTimerUI() {
    var sec = elapsedSec();
    var el = $('build-timer');
    el.textContent = '⏱ ' + formatTime(sec) + ' / par ' + formatTime(level.par);
    el.classList.toggle('over', sec > level.par);
    updateStarPreview();
  }

  // Top-right chip: the 3 stars still within reach (built it / no hints / under par)
  function updateStarPreview() {
    var s = [true, level.hintsUsed === 0, elapsedSec() <= level.par];
    var chip = $('reward-chip');
    var html = s.map(function (on) { return '<span class="' + (on ? '' : 'lost') + '">★</span>'; }).join('');
    if (chip.innerHTML !== html) chip.innerHTML = html;
  }

  function updateBuildHud(bonusJustLost) {
    $('bp-count').textContent = level.filled + ' / ' + level.totalCells + ' squares';
    $('bp-bar').style.width = (level.filled / level.totalCells * 100) + '%';

    var left = HINTS_PER_LEVEL - level.hintsUsed;
    var hintBtn = $('btn-hint');
    hintBtn.disabled = left === 0 || level.done;
    hintBtn.textContent = left === 0 ? 'No hints' : '💡 Hint (' + left + ')';
    $('btn-undo').disabled = !level.history.length || level.done;
    $('btn-reset').disabled = !level.pieces.length || level.done;

    updateTimerUI();
    if (bonusJustLost) replayClass($('reward-chip'), 'drop');
  }

  /* ---------------- 6g. Hints & solver ----------------
   * A hint places one correct brick for the player:
   *   1. Search for a full solution that keeps every brick already on the grid;
   *      place the brick it uses for the first empty square.
   *   2. If there is none (the player has painted themselves into a corner), take
   *      off the bricks that differ from the built-in solution, then place one
   *      brick of that solution.
   */

  /**
   * Depth-first tiling search. The first empty picture square (reading order) must be
   * covered by a brick whose own first cell sits on it, so each step only tries
   * "group x orientation" at that one anchor — fast, and colors prune hard.
   * @returns {object|null} { gi, oi, x, y } for the first empty square, or null
   */
  function solve() {
    var m = level.model;
    var gw = m.gridSize.w;
    var size = gw * m.gridSize.h;
    var t = [];
    var occ = [];
    for (var i = 0; i < size; i++) {
      var x = i % gw;
      var y = (i - x) / gw;
      t.push(level.target[y][x]);
      occ.push(!!level.occ[x + ',' + y]);
    }
    var left = level.groups.map(function (g) { return g.left; });
    // Big bricks first: they fail faster
    var order = level.groups.map(function (g, gi) { return gi; }).sort(function (a, b) {
      return level.groups[b].orients[0].length - level.groups[a].orients[0].length;
    });
    var budget = SOLVER_BUDGET;
    var first = null;
    var OUT = {};

    function fits(cells, ox, oy, color) {
      for (var k = 0; k < cells.length; k++) {
        var cx = ox + cells[k][0];
        var cy = oy + cells[k][1];
        if (cx < 0 || cx >= gw || cy < 0 || cy >= m.gridSize.h) return false;
        var idx = cy * gw + cx;
        if (occ[idx] || t[idx] !== color) return false;
      }
      return true;
    }

    function mark(cells, ox, oy, v) {
      for (var k = 0; k < cells.length; k++) occ[(oy + cells[k][1]) * gw + ox + cells[k][0]] = v;
    }

    function rec(start, depth) {
      if (--budget < 0) throw OUT;
      var idx = start;
      while (idx < size && (!t[idx] || occ[idx])) idx++;
      if (idx === size) return true;
      var cx = idx % gw;
      var cy = (idx - cx) / gw;
      for (var a = 0; a < order.length; a++) {
        var gi = order[a];
        var g = level.groups[gi];
        if (!left[gi] || g.color !== t[idx]) continue;
        for (var oi = 0; oi < g.orients.length; oi++) {
          var cells = g.orients[oi];
          var ox = cx - cells[0][0];
          var oy = cy - cells[0][1];
          if (!fits(cells, ox, oy, g.color)) continue;
          mark(cells, ox, oy, true);
          left[gi]--;
          if (rec(idx + 1, depth + 1)) {
            if (depth === 0) first = { gi: gi, oi: oi, x: ox, y: oy };
            return true;
          }
          left[gi]++;
          mark(cells, ox, oy, false);
        }
      }
      return false;
    }

    try {
      rec(0, 0);
    } catch (e) {
      if (e !== OUT) throw e;
    }
    return first;
  }

  // Key of a brick by its exact squares + color, to compare with the built-in solution
  function placedKey(color, cells, x, y) {
    return color + '|' + absCells(cells, x, y).map(function (c) { return c.join(','); }).sort().join(' ');
  }

  /** Dead end: remove every placed brick that isn't part of the built-in solution. */
  function clearOffSolution() {
    var ref = {};
    level.model.bricks.forEach(function (b) { ref[placedKey(b.color, Models.brickCells(b), b.x, b.y)] = true; });
    var off = level.pieces.filter(function (p) { return !ref[placedKey(p.color, p.cells, p.x, p.y)]; });
    off.forEach(removePiece);
    return off.length;
  }

  /** A built-in solution brick whose squares are all free, as a placement. */
  function referenceMove() {
    var rotate = level.rules.rotate;
    var bricks = level.model.bricks;
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      var cells = Models.brickCells(b);
      if (checkPlace(cells, b.color, b.x, b.y) !== 'ok') continue;
      var key = groupKey(b, rotate);
      for (var gi = 0; gi < level.groups.length; gi++) {
        var g = level.groups[gi];
        if (g.key !== key || !g.left) continue;
        var ck = Models.cellsKey(cells);
        for (var oi = 0; oi < g.orients.length; oi++) {
          if (Models.cellsKey(g.orients[oi]) === ck) return { gi: gi, oi: oi, x: b.x, y: b.y };
        }
      }
    }
    return null;
  }

  function giveHint() {
    if (!level || level.done) return;
    var move = solve();
    var cleared = 0;
    if (!move) {
      cleared = clearOffSolution();
      move = referenceMove();
    }
    if (!move) return; // can't happen with valid data, but never crash on a hint

    level.hintsUsed++;
    level.history = []; // hints rearrange the grid; undo starts fresh from here
    var piece = newPiece(move.gi, move.oi, move.x, move.y);
    addPiece(piece);
    level.flash = { piece: piece, until: performance.now() + FLASH_MS };

    playSound('hint');
    track('bricks_hint_used', { model_id: level.model.id, cleared: cleared });
    if (cleared) toast('Took off ' + cleared + ' brick' + (cleared > 1 ? 's' : '') + ' that blocked the solution');
    else toast('Here\'s one — glowing gold!');
    updateBuildHud(level.hintsUsed === 1);
    afterBoardChange();
  }

  $('btn-hint').addEventListener('click', function () {
    if (!level || level.done || level.hintsUsed >= HINTS_PER_LEVEL) return;
    playSound('tap');
    openModal('hint-modal');
  });

  $('btn-hint-no').addEventListener('click', function () {
    closeModal('hint-modal');
  });

  $('btn-hint-yes').addEventListener('click', function () {
    closeModal('hint-modal');
    if (typeof window.showRewarded === 'function') window.showRewarded(giveHint);
    else giveHint();
  });

  /* ---------------- Blueprint zoom ---------------- */

  $('blueprint-card').addEventListener('click', function () {
    if (!level) return;
    var size = Math.min(screens.build.clientWidth - 64, 340);
    drawPicture($('zoom-canvas'), level.model, size);
    openModal('zoom-modal');
    playSound('tap');
  });

  $('zoom-modal').addEventListener('click', function () {
    closeModal('zoom-modal');
  });

  /* ---------------- 6h. Finish & leave ---------------- */

  function finishLevel() {
    if (level.done) return;
    var m = level.model;
    level.done = true;
    cancelDrag();
    updateBuildHud(false);
    // Save stars right away; the results screen only shows what was already stored
    completeLevel(level);

    // Let the last brick's pop play before switching screens
    setTimeout(function () {
      if (!level || level.model !== m) return;
      showResults();
    }, 500);
  }

  function leaveBuild() {
    cancelDrag();
    level = null;
    showHome();
  }

  // Leaving with bricks on the grid asks first (progress isn't saved mid-level)
  $('btn-build-back').addEventListener('click', function () {
    if (level && level.pieces.length > 0 && !level.done) {
      openModal('leave-modal');
      return;
    }
    leaveBuild();
  });

  // Closing / reloading the tab mid-level (e.g. a stray swipe or tap) asks the browser to confirm
  window.addEventListener('beforeunload', function (e) {
    if (level && level.pieces.length > 0 && !level.done) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  $('btn-leave-stay').addEventListener('click', function () {
    closeModal('leave-modal');
  });

  $('btn-leave-go').addEventListener('click', function () {
    closeModal('leave-modal');
    leaveBuild();
  });

  /* =========================================================
   * 7. Results screen & star economy
   *    Stars are saved the moment the last brick lands (before any animation
   *    or ad), so closing the tab on the results screen can't lose them.
   * ========================================================= */

  var STAR_STEP_MS = 380;            // delay between stars popping in
  var INTERSTITIAL_DELAY_MS = 2000;  // results screen shows this long before the interstitial

  /*
   * result = {
   *   model, pieces (the player's build), runStars, criteria { noHint, underPar },
   *   timeSec, par, prevBest, awarded (stars added this run, incl. doubling), doubled,
   *   unlockQueue: [pack, ...] waiting for the popup,
   *   adCalled, adDone, adTimer, starTimer
   * }
   */
  var result = null;

  /**
   * Star rules (single source of truth). Each level gives up to 3 stars:
   *   ★ built it   ★ no hints used   ★ finished within par time
   * Only improvements count: replaying adds (new stars - best stars so far), so a
   * level can never be farmed, but a 1★ clear can be upgraded to 3★ later.
   */
  function calcRunStars(hintsUsed, timeSec, par) {
    var noHint = hintsUsed === 0;
    var underPar = timeSec <= par;
    return { stars: 1 + (noHint ? 1 : 0) + (underPar ? 1 : 0), noHint: noHint, underPar: underPar };
  }

  /**
   * Add stars to the saved total and unlock any pack the new total reaches.
   * @returns {object[]} packs unlocked by this call
   */
  function addStars(n) {
    if (n <= 0) return [];
    state.stars += n;
    save(KEYS.STARS, state.stars);
    var fresh = syncUnlockedPacks();
    fresh.forEach(function (pack) { track('bricks_pack_unlocked', { pack_id: pack.id }); });
    return fresh;
  }

  /** Last brick placed: save progress and prepare the results data. */
  function completeLevel(lv) {
    var m = lv.model;
    var timeSec = Math.floor(lv.elapsed / 1000);
    var run = calcRunStars(lv.hintsUsed, timeSec, lv.par);
    var prevBest = bestStars(m.id);
    var awarded = Math.max(0, run.stars - prevBest);

    if (!isCompleted(m.id)) {
      state.completed.push(m.id);
      save(KEYS.COMPLETED, state.completed);
    }
    if (run.stars > prevBest) {
      state.best[m.id] = run.stars;
      save(KEYS.BEST, state.best);
    }
    var fresh = addStars(awarded);
    track('bricks_level_complete', {
      model_id: m.id,
      stars_earned: awarded,
      stars_run: run.stars,
      used_hints: lv.hintsUsed,
      time_sec: timeSec
    });

    result = {
      model: m,
      pieces: lv.pieces.slice(),
      runStars: run.stars,
      criteria: run,
      timeSec: timeSec,
      par: lv.par,
      prevBest: prevBest,
      awarded: awarded,
      baseAward: awarded,
      doubled: false,
      unlockQueue: fresh,
      adCalled: false,
      adDone: false,
      adTimer: null,
      starTimer: null
    };
  }

  function showResults() {
    var r = result;
    var m = r.model;
    $('result-title').textContent = r.runStars === 3 ? 'Perfect Build!' : 'Level Complete!';
    $('result-model').textContent = m.name;
    drawBuild($('result-preview'), m, r.pieces, 150);

    // Three empty star slots that fill up one by one
    var slots = $('result-stars');
    slots.innerHTML = '<span class="s">★</span><span class="s">★</span><span class="s">★</span>';

    $('crit-hint').className = 'crit ' + (r.criteria.noHint ? 'ok' : 'miss');
    $('crit-hint').textContent = r.criteria.noHint ? '✓ No hints used' : '✗ Used a hint';
    $('crit-par').className = 'crit ' + (r.criteria.underPar ? 'ok' : 'miss');
    $('crit-par').textContent = (r.criteria.underPar ? '✓ Beat par' : '✗ Over par') +
      ' · ' + formatTime(r.timeSec) + ' / ' + formatTime(r.par);

    renderEarned();
    $('result-total').textContent = state.stars - r.awarded;

    // ads.js hides this button with an inline style while ads are off; only toggle our class here
    var dbl = $('btn-double');
    dbl.classList.toggle('hidden', r.awarded === 0);
    dbl.disabled = false;
    dbl.textContent = '▶ Watch Ad to Double Stars';

    var next = nextModel(m.id);
    $('btn-result-next').classList.toggle('hidden', !next);
    $('btn-result-home').className = next ? 'btn secondary' : 'btn';

    showScreen('result');
    playSound('complete');
    var shown = 0;
    var stars = slots.querySelectorAll('.s');
    (function step() {
      if (result !== r || shown >= r.runStars) {
        // all stars in: count the total up to the saved value
        if (result === r) $('result-total').textContent = state.stars;
        return;
      }
      stars[shown].classList.add('on');
      shown++;
      playSound('star', { n: shown });
      r.starTimer = setTimeout(step, STAR_STEP_MS);
    })();
    r.adTimer = setTimeout(function () { runInterstitial(null); }, INTERSTITIAL_DELAY_MS);
  }

  // "+2 ⭐ earned" line, or the practice note when this run didn't beat the best
  function renderEarned() {
    var r = result;
    var earned = $('result-earned');
    var note = $('practice-note');
    earned.classList.toggle('hidden', r.awarded === 0);
    note.classList.toggle('hidden', r.awarded !== 0);
    if (r.awarded) {
      earned.textContent = '+' + r.awarded + ' ⭐ earned' + (r.doubled ? ' (×2)' : '');
    } else if (r.prevBest >= 3) {
      note.textContent = 'Already completed. No stars this time, but you can still practice!';
    } else {
      note.textContent = 'Your best here is ' + r.prevBest + ' ⭐. Beat it to earn more!';
    }
  }

  /* ---------------- Double stars (rewarded ad, once per result) ---------------- */

  $('btn-double').addEventListener('click', function () {
    var r = result;
    if (!r || !r.baseAward || r.doubled) return;
    var give = function () {
      if (result !== r || r.doubled) return;
      r.doubled = true;
      r.awarded += r.baseAward;
      r.unlockQueue = r.unlockQueue.concat(addStars(r.baseAward));
      track('bricks_stars_doubled', { model_id: r.model.id });

      var btn = $('btn-double');
      btn.disabled = true;
      btn.textContent = 'Stars Doubled! ✓';
      renderEarned();
      $('result-total').textContent = state.stars;
      replayClass($('result-total'), 'bump');
      playSound('star', { n: 4 });
      flushUnlocks();
    };
    if (typeof window.showRewarded === 'function') window.showRewarded(give);
    else give();
  });

  /* ---------------- Interstitial & unlock popup ----------------
   * The interstitial runs once per results screen: 2 s after it opens, or right
   * away if the player leaves sooner (ads.js decides whether it really shows).
   * The "new pack" popup waits until the interstitial is out of the way. */

  function runInterstitial(next) {
    var r = result;
    if (!r || r.adCalled) {
      if (next) next();
      return;
    }
    clearTimeout(r.adTimer);
    r.adCalled = true;
    var after = function () {
      r.adDone = true;
      if (next) next();
      else flushUnlocks();
    };
    if (typeof window.showInterstitial === 'function') window.showInterstitial(after);
    else after();
  }

  function flushUnlocks() {
    var r = result;
    if (!r || !r.adDone || !r.unlockQueue.length) return;
    $('unlock-title').textContent = 'New pack unlocked: ' + packNames(r.unlockQueue) + '!';
    r.unlockQueue = [];
    openModal('unlock-modal');
    playSound('reveal');
  }

  function packNames(packs) {
    return packs.map(function (p) { return p.name; }).join(' & ');
  }

  $('btn-unlock-ok').addEventListener('click', function () {
    closeModal('unlock-modal');
    playSound('tap');
  });

  /* ---------------- Leaving the results screen ---------------- */

  function leaveResults(next) {
    var r = result;
    if (!r) return next();
    clearTimeout(r.starTimer);
    runInterstitial(function () {
      // Unlocks the player hasn't seen yet still get announced, as a toast
      var unseen = r.unlockQueue;
      result = null;
      closeModal('unlock-modal');
      next();
      if (unseen.length) toast('New pack unlocked: ' + packNames(unseen) + '!');
    });
  }

  $('btn-result-next').addEventListener('click', function () {
    var next = result && nextModel(result.model.id);
    playSound('tap');
    if (next) leaveResults(function () { openBuild(next); });
  });

  $('btn-result-home').addEventListener('click', function () {
    playSound('tap');
    leaveResults(leaveBuild);
  });

  $('btn-result-again').addEventListener('click', function () {
    var m = result && result.model;
    playSound('tap');
    leaveResults(function () { openBuild(m); });
  });

  /* =========================================================
   * 8. Startup
   * ========================================================= */

  // Re-fit on rotation / address bar / desktop resize.
  // Home only depends on width; the build screen also needs the height.
  var lastWidth = window.innerWidth;
  window.addEventListener('resize', function () {
    if (!screens.build.classList.contains('hidden')) {
      cancelDrag();
      layoutBuild();
    } else if (window.innerWidth !== lastWidth) {
      drawThumbnails();
    }
    lastWidth = window.innerWidth;
  });

  if (typeof window.showBanner === 'function') window.showBanner('ad-banner');
  updateMuteUI();
  showHome();
  maybeShowTutorial();

  // Exposed for debugging in the console during development
  window.BricksGame = {
    KEYS: KEYS,
    state: state,
    isPackUnlocked: isPackUnlocked,
    level: function () { return level; },
    solve: function () { return level && solve(); },
    _open: function (m) { openBuild(m); } // test hook: open any model, ignoring locks
  };
})();
