/* =========================================================
 * microgames/engine.js — the 60-Second Microgames engine
 *
 * Runs a "round": one or more segments (a microgame + how long it lasts)
 * inside the full-screen #stage layer of the lobby page. Owns the clock, the
 * score, the HUD, the hint/"Go!" intro and the Time's Up modal, and makes
 * sure each microgame's listeners and animation loop are gone when it ends.
 *
 * ---------------- Microgame interface ----------------
 * Each file in games/ calls MicroEngine.register({
 *   id:   'color',              // unique key (storage, analytics)
 *   name: 'Color Rush',         // shown in the HUD / results
 *   hint: 'Tap the color you read!',  // shown big before the clock starts
 *   icon: '🎨',                 // optional, used on the challenge breakdown
 *   init(engine)                // build the game inside engine.container
 *   update(delta)               // called every frame while the clock runs (seconds)
 *   destroy()                   // drop any state (DOM / listeners are cleaned up for you)
 * });
 *
 * What `engine` gives a microgame:
 *   engine.container            the element to render into (already empty)
 *   engine.createCanvas()       full-size HiDPI canvas: { canvas, ctx, w, h } (w/h in CSS px,
 *                               kept up to date on resize; ctx is pre-scaled)
 *   engine.on(target, type, fn, opts)   addEventListener that is removed automatically
 *   engine.addScore(n)          add (or subtract) points
 *   engine.elapsed / .duration / .timeLeft   seconds into / length of / left in this segment
 *   engine.popText(x, y, text, kind)  floating "+10" at container coords (kind: 'good' | 'bad')
 *   engine.shake()              shake the play area
 *   engine.sound(name, params)  Sound.play from shared/sound.js
 *
 * Random Challenge: MicroEngine.challenge() plays CHALLENGE_GAMES different
 * microgames for CHALLENGE_SECONDS each, with a white "Next Up: <name>!" fade
 * between them, one summed score, and a Jackpot! results screen.
 *
 * Analytics: microgame_start { game_id }, microgame_end { game_id, score }
 * Ads: "Watch Ad to Double Score" (rewarded, once per round), interstitial
 *      every INTERSTITIAL_EVERY rounds when leaving the results screen.
 * ========================================================= */
(function () {
  'use strict';

  var CFG = {
    ROUND_SECONDS: 60,           // single-game round length
    POINTS_PER_COIN: 10,         // coins earned = score / this
    INTRO_MS: 1400,              // hint + "Go!" before the clock starts
    INTERSTITIAL_EVERY: 3,       // rounds between interstitial ads
    CHALLENGE_GAMES: 3,          // Random Challenge: this many different games...
    CHALLENGE_SECONDS: 20,       // ...this long each
    FADE_MS: 350,                // white fade in / out between challenge games
    NEXT_UP_MS: 1100,            // how long "Next Up: ..." stays on the white screen
    JACKPOT_COUNT_MS: 1300,      // score count-up on the challenge results
    MAX_DPR: 2
  };
  var ROUNDS_KEY = 'microgames_rounds'; // sessionStorage: rounds finished this session

  var games = {};                // id -> microgame object
  var $ = function (id) { return document.getElementById(id); };
  var ui = {
    stage: $('stage'),
    play: $('play'),
    name: $('hud-name'),
    score: $('hud-score'),
    timer: $('hud-timer'),
    bar: $('hud-bar'),
    quit: $('btn-quit'),
    intro: $('intro'),
    pause: $('pause'),
    modal: $('result'),
    resTitle: $('res-title'),
    resGame: $('res-game'),
    resScore: $('res-score'),
    resBest: $('res-best'),
    resCoins: $('res-coins'),
    btnDouble: $('btn-double'),
    btnAgain: $('btn-again'),
    btnLobby: $('btn-lobby'),
    transition: $('transition'),
    breakdown: $('res-breakdown'),
    jackpot: $('jackpot'),
    result: $('result')
  };

  /* ---------------- Round state ---------------- */
  var round = null;   // { segments, index, mode, score, ... } while a round is open
  var seg = null;     // { game, duration, elapsed, cleanup: [], canvases: [] } current segment
  var rafId = 0;
  var lastT = 0;
  var running = false;  // clock ticking
  var shownScore = null, shownTime = null;

  /* ---------------- Engine object handed to microgames ---------------- */
  var engine = {
    container: ui.play,

    get elapsed() { return seg ? seg.elapsed : 0; },
    get duration() { return seg ? seg.duration : 0; },
    get timeLeft() { return seg ? Math.max(0, seg.duration - seg.elapsed) : 0; },
    get score() { return round ? round.score : 0; },

    addScore: function (n) {
      if (!round || !running) return;
      round.score = Math.max(0, round.score + n); // never below zero: friendlier
      round.segScore += n;
      renderHud(n);
    },

    on: function (target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      seg.cleanup.push(function () { target.removeEventListener(type, fn, opts); });
    },

    createCanvas: function () {
      var canvas = document.createElement('canvas');
      canvas.className = 'mg-canvas';
      ui.play.appendChild(canvas);
      var view = { canvas: canvas, ctx: canvas.getContext('2d'), w: 0, h: 0 };
      var fit = function () {
        var dpr = Math.min(window.devicePixelRatio || 1, CFG.MAX_DPR);
        view.w = ui.play.clientWidth;
        view.h = ui.play.clientHeight;
        canvas.width = Math.round(view.w * dpr);
        canvas.height = Math.round(view.h * dpr);
        view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      fit();
      engine.on(window, 'resize', fit);
      return view;
    },

    popText: function (x, y, text, kind) {
      var el = document.createElement('div');
      el.className = 'pop-text ' + (kind || '');
      el.textContent = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      ui.play.appendChild(el);
      setTimeout(function () { el.remove(); }, 800);
    },

    shake: function () {
      ui.play.classList.remove('shake');
      void ui.play.offsetWidth; // restart the animation
      ui.play.classList.add('shake');
    },

    sound: function (name, params) {
      if (window.Sound) Sound.play(name, params);
    }
  };

  /* ---------------- Public API ---------------- */
  function register(game) {
    games[game.id] = game;
  }

  /**
   * Starts a round.
   * @param {Array<{id: string, seconds: number}>} segments games to play back to back
   * @param {string} mode 'single' | 'challenge' (stored with best scores / analytics)
   */
  function startRound(segments, mode) {
    if (round) teardownSegment();
    round = {
      segments: segments,
      index: -1,
      mode: mode,
      score: 0,
      segScore: 0,
      segScores: [],             // points each segment added to the total (challenge breakdown)
      doubled: false,
      key: mode === 'single' ? segments[0].id : mode
    };
    ui.modal.classList.add('hidden');
    ui.pause.classList.add('hidden');
    if (!ui.stage.classList.contains('open')) {
      ui.stage.classList.add('open');
      document.documentElement.classList.add('stage-open');
      history.pushState({ microgame: true }, ''); // phone back button = leave the game
    }
    shownScore = shownTime = null;
    renderHud(0);
    nextSegment();
  }

  function play(id) {
    if (!games[id]) return false;
    startRound([{ id: id, seconds: CFG.ROUND_SECONDS }], 'single');
    return true;
  }

  /* ---------------- Segments ---------------- */
  function nextSegment() {
    round.index++;
    var spec = round.segments[round.index];
    var game = games[spec.id];
    seg = { game: game, duration: spec.seconds, elapsed: 0, cleanup: [] };
    round.segScore = 0;
    round.segStart = round.score;
    ui.play.innerHTML = '';
    var n = round.segments.length;
    ui.name.textContent = n > 1 ? 'Game ' + (round.index + 1) + '/' + n + ' · ' + game.name : game.name;

    var build = function () {
      game.init(engine);
      game.update(0); // draw the first frame behind the intro
    };
    // Hint, then "Go!", then the clock starts
    var go = function () {
      showIntro(game.hint, function () {
        running = true;
        trackEvent('microgame_start', { game_id: game.id, mode: round.mode });
        startLoop();
      });
    };
    if (round.mode === 'challenge') showTransition(game, build, go);
    else {
      build();
      go();
    }
  }

  /* Challenge: fade to white, "Next Up: <name>!", build the game while the
   * screen is covered, fade back out, then the usual hint / Go! */
  function showTransition(game, onCovered, onDone) {
    var t = ui.transition;
    t.innerHTML = '<div class="count"></div><div class="next"></div>';
    t.firstChild.textContent = 'Game ' + (round.index + 1) + ' of ' + round.segments.length;
    t.lastChild.textContent = 'Next Up: ' + game.name + '!';
    t.classList.remove('hidden');
    void t.offsetWidth;   // let the browser see opacity 0 before fading in
    t.classList.add('on');
    var timers = [
      setTimeout(function () {
        onCovered();
        t.classList.add('show-text');
        engine.sound('tap');
      }, CFG.FADE_MS),
      setTimeout(function () { t.classList.remove('on', 'show-text'); }, CFG.FADE_MS + CFG.NEXT_UP_MS),
      setTimeout(function () {
        t.classList.add('hidden');
        onDone();
      }, CFG.FADE_MS * 2 + CFG.NEXT_UP_MS)
    ];
    seg.cleanup.push(function () {
      timers.forEach(clearTimeout);
      t.classList.remove('on', 'show-text');
      t.classList.add('hidden');
    });
  }

  function showIntro(hint, done) {
    ui.intro.innerHTML = '<div class="hint"></div><div class="go">Ready…</div>';
    ui.intro.firstChild.textContent = hint;
    ui.intro.classList.remove('hidden');
    var go = ui.intro.lastChild;
    var t1 = setTimeout(function () {
      go.textContent = 'Go!';
      go.classList.add('now');
      engine.sound('tap');
    }, CFG.INTRO_MS * 0.6);
    var t2 = setTimeout(function () {
      ui.intro.classList.add('hidden');
      done();
    }, CFG.INTRO_MS);
    seg.cleanup.push(function () { clearTimeout(t1); clearTimeout(t2); });
  }

  function endSegment() {
    running = false;
    stopLoop();
    trackEvent('microgame_end', { game_id: seg.game.id, score: round.segScore, mode: round.mode });
    round.segScores.push({ game: seg.game, points: round.score - round.segStart });
    teardownSegment();
    if (round.index < round.segments.length - 1) nextSegment();
    else finishRound();
  }

  /* Removes everything the microgame added: listeners, timers, DOM, canvases */
  function teardownSegment() {
    running = false;
    stopLoop();
    if (!seg) return;
    try {
      seg.game.destroy();
    } catch (e) {
      console.error(e);
    }
    seg.cleanup.forEach(function (fn) { fn(); });
    ui.play.innerHTML = '';
    seg = null;
  }

  /* ---------------- Loop ---------------- */
  function startLoop() {
    stopLoop();
    lastT = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(t) {
    rafId = requestAnimationFrame(frame);
    var delta = Math.min(0.1, (t - lastT) / 1000); // clamp hiccups
    lastT = t;
    if (!running || !seg) return;
    seg.elapsed = Math.min(seg.duration, seg.elapsed + delta);
    seg.game.update(delta);
    renderHud(0);
    if (seg && seg.elapsed >= seg.duration) endSegment();
  }

  /* ---------------- HUD ---------------- */
  function renderHud(change) {
    if (!round) return;
    var total = 0, done = 0;
    round.segments.forEach(function (s, i) {
      total += s.seconds;
      if (i < round.index) done += s.seconds;
    });
    var used = done + (seg ? seg.elapsed : 0);
    var left = Math.max(0, Math.ceil(total - used));
    if (left !== shownTime) {
      shownTime = left;
      ui.timer.textContent = left;
      ui.timer.classList.toggle('low', left <= 10);
    }
    ui.bar.style.width = (100 * (1 - used / total)).toFixed(2) + '%';
    if (round.score !== shownScore) {
      shownScore = round.score;
      ui.score.textContent = round.score;
      if (change) {
        ui.score.classList.remove('up', 'down');
        void ui.score.offsetWidth;
        ui.score.classList.add(change > 0 ? 'up' : 'down');
      }
    }
  }

  /* ---------------- Results ---------------- */
  function bestKey() {
    return 'microgames_best_' + round.key;
  }
  function loadNum(key, store) {
    try {
      return parseInt((store || localStorage).getItem(key), 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveNum(key, n, store) {
    try {
      (store || localStorage).setItem(key, String(n));
    } catch (e) { /* ignore */ }
  }

  function finishRound() {
    var r = round;
    r.coins = Math.floor(r.score / CFG.POINTS_PER_COIN);
    if (r.coins) Coins.add(r.coins);
    r.prevBest = loadNum(bestKey());
    if (r.score > r.prevBest) saveNum(bestKey(), r.score);
    saveNum(ROUNDS_KEY, loadNum(ROUNDS_KEY, sessionStorage) + 1, sessionStorage);
    engine.sound(r.score > r.prevBest && r.score > 0 ? 'win' : 'gameover');
    showResults();
  }

  function showResults() {
    var r = round;
    ui.resTitle.textContent = "Time's Up!";
    ui.resGame.textContent = r.mode === 'single' ? games[r.segments[0].id].name : 'Random Challenge';
    ui.resScore.textContent = r.score;
    renderBreakdown(r);
    ui.resBest.textContent = r.score > r.prevBest && r.score > 0 ? '🎉 New best!' : 'Best: ' + Math.max(r.prevBest, r.score);
    ui.resCoins.textContent = r.coins ? '+' + r.coins + ' 🪙' : 'Score ' + CFG.POINTS_PER_COIN + '+ to earn coins';
    // Doubling a zero score is pointless; once per round
    ui.btnDouble.classList.toggle('hidden', r.doubled || r.score <= 0);
    ui.modal.classList.remove('hidden');
    if (r.mode === 'challenge' && !r.jackpotShown) {
      r.jackpotShown = true;
      jackpot(r.score);
    }
  }

  /* Challenge results: one row per game */
  function renderBreakdown(r) {
    ui.breakdown.innerHTML = '';
    ui.breakdown.classList.toggle('hidden', r.mode !== 'challenge');
    if (r.mode !== 'challenge') return;
    r.segScores.forEach(function (s) {
      var row = document.createElement('div');
      row.innerHTML = '<span></span><b></b>';
      row.firstChild.textContent = (s.game.icon ? s.game.icon + ' ' : '') + s.game.name;
      row.lastChild.textContent = (s.points >= 0 ? '+' : '') + s.points;
      ui.breakdown.appendChild(row);
    });
  }

  /* "Jackpot!": banner, the total rolling up like a slot machine, coin shower */
  function jackpot(total) {
    ui.jackpot.classList.remove('hidden', 'play');
    void ui.jackpot.offsetWidth;
    ui.jackpot.classList.add('play');
    engine.sound('reveal');

    var start = performance.now();
    var roll = function (now) {
      if (!round || ui.modal.classList.contains('hidden')) return;
      var k = Math.min(1, (now - start) / CFG.JACKPOT_COUNT_MS);
      var eased = 1 - Math.pow(1 - k, 3);
      ui.resScore.textContent = Math.round(total * eased);
      if (k < 1) requestAnimationFrame(roll);
      else {
        ui.resScore.textContent = round.score; // in case it was doubled meanwhile
        ui.resScore.classList.add('landed');
      }
    };
    ui.resScore.classList.remove('landed');
    requestAnimationFrame(roll);

    for (var i = 0; i < 22; i++) {
      var c = document.createElement('span');
      c.className = 'coin-drop';
      c.textContent = '🪙';
      c.style.left = Math.random() * 100 + '%';
      c.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
      c.style.animationDuration = (1.4 + Math.random() * 0.8).toFixed(2) + 's';
      c.style.fontSize = (18 + Math.random() * 16) + 'px';
      ui.result.appendChild(c);
      setTimeout(c.remove.bind(c), 3300);
    }
  }

  ui.btnDouble.addEventListener('click', function () {
    var r = round;
    if (!r || r.doubled) return;
    showRewarded(function () {
      r.doubled = true;
      r.score *= 2;
      if (r.coins) Coins.add(r.coins); // the doubled score earns the coins again
      r.coins *= 2;
      if (r.score > loadNum(bestKey())) saveNum(bestKey(), r.score);
      trackEvent('microgame_doubled', { game_id: r.key, score: r.score });
      engine.sound('win');
      showResults();
    });
  });

  // Interstitial before moving on: every few finished rounds, and always when a
  // Random Challenge returns to the lobby (ads.js still applies its frequency cap)
  function afterResults(next, toLobby) {
    var n = loadNum(ROUNDS_KEY, sessionStorage);
    var challengeExit = toLobby && round && round.mode === 'challenge';
    if (challengeExit || (n > 0 && n % CFG.INTERSTITIAL_EVERY === 0)) showInterstitial(next);
    else next();
  }

  ui.btnAgain.addEventListener('click', function () {
    var r = round;
    afterResults(function () {
      if (r.mode === 'challenge') challenge(); // a fresh random draw
      else startRound(r.segments, r.mode);
    });
  });
  ui.btnLobby.addEventListener('click', function () {
    afterResults(function () { history.back(); }, true); // popstate closes the stage
  });

  /* Random Challenge: CHALLENGE_GAMES different microgames in random order */
  function challenge() {
    var pool = Object.keys(games);
    for (var i = pool.length - 1; i > 0; i--) { // Fisher-Yates shuffle
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    var picks = pool.slice(0, CFG.CHALLENGE_GAMES);
    if (!picks.length) return false;
    startRound(picks.map(function (id) { return { id: id, seconds: CFG.CHALLENGE_SECONDS }; }), 'challenge');
    return true;
  }
  ui.quit.addEventListener('click', function () { history.back(); });

  /* ---------------- Global mute ----------------
   * Every [data-mute] button (lobby top bar + in-game HUD) toggles the
   * site-wide setting in shared/sound.js and they all show the same icon. */
  var muteButtons = Array.prototype.slice.call(document.querySelectorAll('[data-mute]'));
  function renderMute() {
    var muted = window.Sound ? Sound.isMuted() : false;
    muteButtons.forEach(function (b) {
      b.textContent = muted ? '🔇' : '🔊';
      b.setAttribute('aria-pressed', String(muted));
    });
  }
  muteButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      if (!window.Sound) return;
      Sound.toggle();
      renderMute();
      if (!Sound.isMuted()) Sound.play('tap'); // a little confirmation blip
    });
  });
  // Muted / unmuted in another tab (another game)
  window.addEventListener('storage', function (ev) {
    if (ev.key === 'sound_muted' && window.Sound) {
      if ((ev.newValue === '1') !== Sound.isMuted()) Sound.toggle();
      renderMute();
    }
  });
  renderMute();

  /* ---------------- Closing / pausing ---------------- */
  function close() {
    teardownSegment();
    round = null;
    ui.stage.classList.remove('open');
    ui.modal.classList.add('hidden');
    ui.intro.classList.add('hidden');
    ui.pause.classList.add('hidden');
    ui.transition.classList.add('hidden');
    document.documentElement.classList.remove('stage-open');
    if (MicroEngine.onClose) MicroEngine.onClose();
  }
  window.addEventListener('popstate', function () {
    if (ui.stage.classList.contains('open')) close();
  });

  // Tab hidden / app switched mid-game: freeze the clock behind a Paused card
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && running) {
      running = false;
      stopLoop();
      ui.pause.classList.remove('hidden');
    }
  });
  $('btn-resume').addEventListener('click', function () {
    ui.pause.classList.add('hidden');
    if (seg) {
      running = true;
      startLoop();
    }
  });

  window.MicroEngine = {
    register: register,
    play: play,
    challenge: challenge,
    startRound: startRound,
    has: function (id) { return !!games[id]; },
    ids: function () { return Object.keys(games); },
    games: games,
    CFG: CFG,
    onClose: null           // set by the lobby: refresh best scores
  };
})();
