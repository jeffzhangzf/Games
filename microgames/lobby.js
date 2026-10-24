/* =========================================================
 * microgames/lobby.js — lobby screen for 60-Second Microgames
 * Renders the coin balance and the microgame grid, wires the
 * "Start Random Challenge" button.
 *
 * localStorage keys:
 *   site_coins            shared coin wallet (shared/coins.js)
 *   microgames_best_<id>  best single-game score per microgame
 *   microgames_best_challenge  best Random Challenge total
 * ========================================================= */
(function () {
  'use strict';

  /* Microgame catalogue shown in the lobby. `ready: false` = Coming Soon.
   * (The engine in Phase 2 loads the playable ones from games/<id>.js.) */
  var GAMES = [
    { id: 'color', name: 'Color Rush', hint: 'Match the color!', icon: '🎨', color: '#f1e6ff', ready: true },
    { id: 'catch', name: 'Fruit Catch', hint: 'Drag to catch!', icon: '🧺', color: '#e6f7dd', ready: true },
    { id: 'whack', name: 'Whack-a-Mole', hint: 'Tap the moles!', icon: '🔨', color: '#fbeedc', ready: true },
    { id: 'memory', name: 'Memory Flash', hint: 'Remember the pattern!', icon: '🧠', color: '#ffe3ea', ready: false },
    { id: 'tap', name: 'Speed Tap', hint: 'Tap as fast as you can!', icon: '👆', color: '#fff3c4', ready: false },
    { id: 'shape', name: 'Shape Sort', hint: 'Swipe shapes into place!', icon: '🔷', color: '#dff1ff', ready: false }
  ];

  function load(key) {
    try {
      return parseInt(localStorage.getItem(key), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  /* ---------------- Coins ---------------- */
  var coinBox = document.getElementById('coins');
  var coinCount = document.getElementById('coin-count');
  function showCoins(n) {
    coinCount.textContent = n.toLocaleString('en-US');
    coinBox.classList.remove('bump');
    void coinBox.offsetWidth; // restart the animation
    coinBox.classList.add('bump');
  }
  coinCount.textContent = Coins.get().toLocaleString('en-US');
  Coins.onChange(showCoins);

  /* ---------------- Grid ---------------- */
  var grid = document.getElementById('mg-grid');
  var challengeNote = document.getElementById('challenge-note');
  function renderGrid() {
    grid.innerHTML = '';
    GAMES.forEach(renderCard);
    var best = load('microgames_best_challenge');
    challengeNote.textContent = best
      ? '🏆 Your best challenge: ' + best + '. Can you beat it?'
      : 'One run, three games, one massive score. Ready?';
  }
  function renderCard(g) {
    var card = document.createElement('button');
    card.className = 'mg-card' + (g.ready ? '' : ' soon');
    card.dataset.game = g.id;
    if (!g.ready) card.disabled = true;

    var icon = document.createElement('span');
    icon.className = 'icon';
    icon.style.background = g.color;
    icon.textContent = g.icon;
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = g.name;
    var hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = g.hint;
    var foot = document.createElement('span');
    if (g.ready) {
      var best = load('microgames_best_' + g.id);
      foot.className = 'best';
      foot.textContent = best ? '🏆 Best: ' + best : 'Play now →';
    } else {
      foot.className = 'tag';
      foot.textContent = 'Coming Soon';
    }
    card.append(icon, name, hint, foot);

    if (g.ready) card.addEventListener('click', function () { play(g.id); });
    grid.appendChild(card);
  }
  renderGrid();

  document.getElementById('btn-challenge').addEventListener('click', function () {
    play('challenge');
  });

  // Back from a round: best scores may have changed (coins update by themselves)
  MicroEngine.onClose = renderGrid;

  /* ---------------- Play ---------------- */
  var toast = document.getElementById('toast');
  var toastTimer = null;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.remove('off');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.add('off'); }, 1800);
  }
  function play(id) {
    trackEvent(EVENTS.GAME_CARD_CLICK, { game: 'microgames/' + id });
    var started = id === 'challenge' ? MicroEngine.challenge() : MicroEngine.play(id);
    if (!started) showToast('Warming up… this one opens soon!');
  }

  showBanner('ad-banner');
})();
