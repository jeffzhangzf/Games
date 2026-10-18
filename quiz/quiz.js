/* =========================================================
 * quiz/quiz.js — Personality Quiz logic
 *
 * Purpose: view switching (start / question / result), scoring,
 *          result page, sharing, rewarded "full report", and analytics.
 *
 * Depends on (loaded in this order by quiz/index.html):
 *   shared/analytics.js → shared/ads.js → shared/sound.js → quiz/data.js → this file
 *
 * How it works:
 *   - One `state` object holds everything (current view, question index, scores).
 *   - showView(name) hides every <section class="view"> and shows the requested one.
 *     No page navigation — the whole quiz is a single page.
 *   - Each run draws questionsPerQuiz questions from the bank (pickQuestions, section 4),
 *     preferring unseen ones, and shuffles every question's option order.
 *   - Scoring lives in computeResult() (see section 4).
 *   - Everything is wrapped in an IIFE, so nothing leaks into the global scope.
 *
 * localStorage keys:
 *   quiz_last_result   id of the most recent result (for the "Last time you got…" line)
 *   quiz_seen_questions  ids of questions already shown in the current rotation
 *   quiz_unlocked_reports  result ids whose full report was unlocked (rewarded ad, once per result)
 *   quiz_completions   number of finished quizzes (3+ → a different welcome line)
 *
 * URL: ?result=<id> shows that result directly (shared links); invalid ids are ignored.
 * ========================================================= */

(function () {
  'use strict';

  const data = window.quizData;

  const CONFIG = {
    ADVANCE_DELAY: 300,                 // ms between tapping an option and the next question
    LONG_QUESTION: 48,                  // questions longer than this (chars) use a smaller font
    LAST_RESULT_KEY: 'quiz_last_result',  // localStorage key for the previous result id
    SEEN_KEY: 'quiz_seen_questions',      // localStorage key for question ids seen this rotation
    TRAIT_MIN: 15,                      // shortest trait bar (%), so no bar is ever empty
    TRAIT_MAX: 95,                      // the winning trait's bar (%)
    TRAIT_ANIM_MS: 900,                 // trait bar grow / count-up duration
    INTERSTITIAL_AFTER: 5,              // show the mid-quiz interstitial once this many questions are answered
    UNLOCKED_KEY: 'quiz_unlocked_reports', // localStorage key: JSON array of result ids whose full report is unlocked
    COMPLETIONS_KEY: 'quiz_completions',   // localStorage key: number of finished quizzes
    REGULAR_AFTER: 3                    // from this many finished quizzes on, the start view greets a regular
  };

  /* =========================================================
   * 1. Safe wrappers for shared modules
   *    (the quiz still works if a shared script fails to load)
   * ========================================================= */
  const EV = window.EVENTS || {};
  function track(name, params) {
    if (name && typeof window.trackEvent === 'function') window.trackEvent(name, params);
  }
  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null; // private mode / storage disabled
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      /* ignore */
    }
  }

  const resultById = (id) => data.results.find((r) => r.id === id) || null;

  /* =========================================================
   * 2. State
   * ========================================================= */
  const state = {
    view: 'start',      // 'start' | 'question' | 'result'
    index: 0,           // current question index (0-based)
    questions: [],      // this run's questions (random draw, options shuffled)
    scores: {},         // result id → points
    reachedAt: {},      // result id → answer number when it reached its current score (for tie-breaks)
    locked: false,      // true during the 0.3s selection animation (blocks double taps)
    resultId: null      // id of the result being shown
  };

  function resetScores() {
    state.index = 0;
    state.scores = {};
    state.reachedAt = {};
    for (const r of data.results) {
      state.scores[r.id] = 0;
      state.reachedAt[r.id] = Infinity;
    }
  }

  /* =========================================================
   * 3. DOM
   * ========================================================= */
  const $ = (id) => document.getElementById(id);
  const ui = {
    views: {
      start: $('view-start'),
      question: $('view-question'),
      result: $('view-result')
    },
    banner: $('ad-banner'),
    startTitle: $('start-title'),
    startSubtitle: $('start-subtitle'),
    lastResult: $('last-result'),
    btnStart: $('btn-start'),
    progressBar: $('progress-bar'),
    qCount: $('q-count'),
    qText: $('q-text'),
    options: $('options'),
    btnQuit: $('btn-quit'),
    rEmoji: $('r-emoji'),
    rTitle: $('r-title'),
    rKicker: $('r-kicker'),
    rDesc: $('r-desc'),
    sharedNote: $('shared-note'),
    traits: $('traits'),
    btnShareNative: $('btn-share-native'),
    btnShareImage: $('btn-share-image'),
    btnCopy: $('btn-share-copy'),
    btnReport: $('btn-report'),
    report: $('report'),
    btnTake: $('btn-take'),
    btnRetake: $('btn-retake'),
    shareOverlay: $('share-overlay'),
    shareImg: $('share-img'),
    btnDownload: $('btn-download'),
    btnOverlayClose: $('btn-overlay-close'),
    toast: $('toast')
  };

  // Views that show the bottom banner (the question view stays distraction-free)
  const BANNER_VIEWS = { start: true, result: true };

  /** Hide every view, show `name`, replay its entrance animation */
  function showView(name) {
    state.view = name;
    for (const key in ui.views) {
      const el = ui.views[key];
      el.hidden = key !== name;
      el.classList.remove('enter');
    }
    const el = ui.views[name];
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('enter');
    ui.banner.style.display = BANNER_VIEWS[name] ? '' : 'none';
    window.scrollTo(0, 0);
  }

  /* =========================================================
   * 4. Question draw & scoring
   * ========================================================= */

  /** Fisher–Yates shuffle (returns a new array) */
  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /**
   * Draw this run's questions from the bank.
   *   - Questions not seen in the current rotation come first, so with a
   *     30-question bank the first three runs never repeat a question.
   *   - When fewer than `count` unseen questions are left, they are all used,
   *     the rest is filled from other questions, and a new rotation starts.
   *   - Every question's options are shuffled, so answer positions change too.
   */
  function pickQuestions() {
    const bank = data.questions;
    const count = Math.min(data.questionsPerQuiz || bank.length, bank.length);
    let seen = [];
    try {
      seen = JSON.parse(storageGet(CONFIG.SEEN_KEY)) || [];
    } catch (e) {
      seen = [];
    }

    const unseen = shuffle(bank.filter((q) => !seen.includes(q.id)));
    let picked;
    if (unseen.length >= count) {
      picked = unseen.slice(0, count);
      seen = seen.concat(picked.map((q) => q.id));
    } else {
      // End of a rotation: use what's left, fill up with others, start a new rotation
      const others = shuffle(bank.filter((q) => seen.includes(q.id)));
      picked = unseen.concat(others.slice(0, count - unseen.length));
      seen = picked.map((q) => q.id);
    }
    storageSet(CONFIG.SEEN_KEY, JSON.stringify(seen));

    return shuffle(picked).map((q) => ({ id: q.id, text: q.text, options: shuffle(q.options) }));
  }

  /* ---------------------------------------------------------
   * Scoring
   *    Highest score wins. On a tie, the result that reached that
   *    score first (earliest answer) wins.
   * --------------------------------------------------------- */
  function addPoint(resultId) {
    state.scores[resultId]++;
    state.reachedAt[resultId] = state.index; // answer number at which this score was reached
  }

  function computeResult() {
    let best = null;
    for (const r of data.results) {
      const s = state.scores[r.id];
      if (
        !best ||
        s > state.scores[best] ||
        (s === state.scores[best] && state.reachedAt[r.id] < state.reachedAt[best])
      ) {
        best = r.id;
      }
    }
    return best;
  }

  /* =========================================================
   * 5. Start view
   * ========================================================= */
  function renderStart() {
    ui.startTitle.textContent = data.title;
    ui.startSubtitle.textContent = data.subtitle;

    // Regulars (3+ completed quizzes) get a different welcome line
    const runs = parseInt(storageGet(CONFIG.COMPLETIONS_KEY), 10) || 0;
    const last = resultById(storageGet(CONFIG.LAST_RESULT_KEY));
    if (last) {
      ui.lastResult.innerHTML = runs >= CONFIG.REGULAR_AFTER
        ? 'Welcome back, regular! Quiz #' + (runs + 1) + ' — last time you got <b></b>. Will it change?'
        : 'Last time you got <b></b>. Retake?';
      ui.lastResult.querySelector('b').textContent = last.emoji + ' ' + last.title;
      ui.lastResult.hidden = false;
      ui.btnStart.textContent = 'Retake Quiz';
    } else {
      ui.lastResult.hidden = true;
      ui.btnStart.textContent = 'Start Quiz';
    }
    showView('start');
  }

  /* =========================================================
   * 6. Question view
   * ========================================================= */
  function startQuiz() {
    resetScores();
    state.questions = pickQuestions();
    track(EV.QUIZ_START, { game: 'quiz' });
    showView('question');
    renderQuestion();
  }

  function setProgress(done) {
    ui.progressBar.style.width = (done / state.questions.length) * 100 + '%';
  }

  function renderQuestion() {
    const q = state.questions[state.index];
    const total = state.questions.length;
    state.locked = false;

    setProgress(state.index);
    ui.qCount.textContent = 'Question ' + (state.index + 1) + ' of ' + total;
    ui.qText.textContent = q.text;
    ui.qText.classList.toggle('long', q.text.length > CONFIG.LONG_QUESTION);

    ui.options.classList.remove('locked');
    ui.options.innerHTML = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.textContent = opt.text;
      btn.dataset.index = i;
      ui.options.appendChild(btn);
    });
  }

  function onOptionTap(btn) {
    if (state.locked || state.view !== 'question') return;
    state.locked = true;

    const q = state.questions[state.index];
    const opt = q.options[Number(btn.dataset.index)];
    btn.classList.add('selected');
    ui.options.classList.add('locked');
    playSound('tap');
    setProgress(state.index + 1); // bar moves immediately, smoothly

    addPoint(opt.result);
    track(EV.QUIZ_ANSWER, { question_index: state.index, question_id: q.id });

    // Wait for the highlight animation, then move on (no going back)
    setTimeout(() => {
      if (state.view !== 'question') return; // player quit during the delay
      state.index++;
      if (state.index < state.questions.length) {
        renderQuestion();
        // Mid-quiz interstitial: the next question is already on screen, the ad
        // opens on top of it afterwards, so the quiz flow never waits on the ad.
        // Frequency capping lives in shared/ads.js.
        if (state.index === CONFIG.INTERSTITIAL_AFTER) setTimeout(showMidQuizAd, 0);
      } else {
        finishQuiz();
      }
    }, CONFIG.ADVANCE_DELAY);
  }

  function showMidQuizAd() {
    if (state.view === 'question' && typeof window.showInterstitial === 'function') window.showInterstitial();
  }

  function quitQuiz() {
    // Nothing is saved — just go back to the start view
    setResultParam(null);
    renderStart();
  }

  /* =========================================================
   * 7. Result view
   * ========================================================= */
  function finishQuiz() {
    const id = computeResult();
    storageSet(CONFIG.LAST_RESULT_KEY, id);
    storageSet(CONFIG.COMPLETIONS_KEY, (parseInt(storageGet(CONFIG.COMPLETIONS_KEY), 10) || 0) + 1);
    track(EV.QUIZ_COMPLETE, { result_type: id });
    setResultParam(id);
    playSound('reveal');
    renderResult(id, state.scores, false);
  }

  /**
   * Trait bar values (0–100), in results[] order.
   * Raw value = times that result was picked / total questions; then it is
   * normalized against the top score and mapped to 15–95%, so the winning
   * trait is always clearly the longest bar and no bar is ever empty.
   */
  function traitPercents(scores) {
    const values = data.results.map((r) => scores[r.id] || 0);
    const max = Math.max.apply(null, values) || 1;
    return values.map((v) => Math.round(CONFIG.TRAIT_MIN + (CONFIG.TRAIT_MAX - CONFIG.TRAIT_MIN) * (v / max)));
  }

  /** A believable profile for shared links (we only know the winner, not the answers) */
  function sharedScores(id) {
    const scores = {};
    const rest = [3, 2, 1];
    for (const r of data.results) scores[r.id] = r.id === id ? 5 : rest.shift();
    return scores;
  }

  /** Bars grow from 0 and numbers count up to their values */
  function renderTraits(r, scores) {
    const pcts = traitPercents(scores);
    ui.traits.innerHTML = '';
    const rows = r.traits.map((name, i) => {
      const row = document.createElement('div');
      row.className = 'trait';
      row.innerHTML = '<div class="trait-head"><span></span><span>0%</span></div><div class="trait-bar"><i></i></div>';
      row.querySelector('span').textContent = name;
      ui.traits.appendChild(row);
      return { bar: row.querySelector('i'), num: row.querySelector('.trait-head span:last-child'), pct: pcts[i] };
    });

    // Wait a moment so the bars visibly grow after the view fades in
    setTimeout(() => {
      rows.forEach((x) => (x.bar.style.width = x.pct + '%'));
      const t0 = performance.now();
      (function step(now) {
        const k = Math.min(1, (now - t0) / CONFIG.TRAIT_ANIM_MS);
        const ease = 1 - Math.pow(1 - k, 3);
        rows.forEach((x) => (x.num.textContent = Math.round(x.pct * ease) + '%'));
        if (k < 1 && state.view === 'result') requestAnimationFrame(step);
      })(t0);
    }, 250);
  }

  /**
   * @param {string}  id      result id
   * @param {object}  scores  result id → points (drives the trait bars)
   * @param {boolean} shared  true when opened from someone else's ?result= link
   */
  function renderResult(id, scores, shared) {
    const r = resultById(id);
    state.resultId = id;
    document.documentElement.style.setProperty('--accent', r.color);
    ui.rEmoji.textContent = r.emoji;
    ui.rKicker.textContent = shared ? 'They are' : 'You are';
    ui.rTitle.textContent = r.title;
    ui.rDesc.textContent = r.description;

    // Shared links invite the visitor to take the quiz instead of "retake"
    ui.sharedNote.hidden = !shared;
    ui.btnTake.hidden = !shared;
    ui.btnRetake.hidden = shared;
    ui.btnReport.hidden = shared;
    renderReport(id, false);

    showView('result');
    renderTraits(r, scores);
    // Restart the emoji pop-in animation every time
    ui.rEmoji.style.animation = 'none';
    void ui.rEmoji.offsetWidth;
    ui.rEmoji.style.animation = '';

    // Pre-render the share image now, so tapping "share" is instant
    // (navigator.share must be called right inside the tap handler)
    prepareShareImage(r);
  }

  /* ---------------------------------------------------------
   * Full report (rewarded ad)
   *    Each result's report is unlocked once; the unlocked ids are kept
   *    in localStorage, so it stays open on later visits. Shared-link
   *    visitors never see it (the button is hidden for them).
   * --------------------------------------------------------- */
  function unlockedReports() {
    try {
      const list = JSON.parse(storageGet(CONFIG.UNLOCKED_KEY));
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function isUnlocked(id) {
    return unlockedReports().includes(id);
  }

  /**
   * Sync the button and the report block with the stored unlock state.
   * @param {boolean} animate  fade the paragraphs in (right after unlocking)
   */
  function renderReport(id, animate) {
    const unlocked = isUnlocked(id) && !ui.btnReport.hidden;
    ui.btnReport.disabled = isUnlocked(id);
    ui.btnReport.textContent = isUnlocked(id)
      ? 'Full Report Unlocked ✓'
      : window.adsEnabled && window.adsEnabled() ? '📺 Watch a video to unlock the full report' : '🔓 Unlock Full Report';

    ui.report.innerHTML = '';
    ui.report.hidden = !unlocked;
    if (!unlocked) return;
    (data.fullReport[id] || []).forEach((text, i) => {
      const p = document.createElement('p');
      p.textContent = text;
      if (animate) {
        p.className = 'fade-in';
        p.style.animationDelay = i * 0.25 + 's';
      }
      ui.report.appendChild(p);
    });
  }

  function unlockReport() {
    const id = state.resultId;
    if (!id || isUnlocked(id) || typeof window.showRewarded !== 'function') return;
    ui.btnReport.disabled = true; // no double taps while the ad is open
    window.showRewarded(
      () => {
        storageSet(CONFIG.UNLOCKED_KEY, JSON.stringify(unlockedReports().concat(id)));
        track(EV.REWARDED_UNLOCKED, { result_type: id });
        if (state.resultId !== id || state.view !== 'result') return;
        playSound('reveal');
        renderReport(id, true);
        ui.report.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      () => {
        ui.btnReport.disabled = false; // ad closed early / failed: no reward
        toast('Watch the whole video to unlock it');
      }
    );
  }

  /* =========================================================
   * 8. URL parameter (?result=id)
   *    Finished quizzes put the result id in the URL, so the address bar
   *    is always the shareable link. Opening such a link skips the quiz.
   * ========================================================= */
  function setResultParam(id) {
    try {
      history.replaceState(null, '', id ? '?result=' + encodeURIComponent(id) : location.pathname);
    } catch (e) {
      /* file:// in some browsers — the share link is still built by shareUrl() */
    }
  }

  function shareUrl(id) {
    return location.href.split(/[?#]/)[0] + '?result=' + encodeURIComponent(id);
  }

  /** Returns a valid result id from the URL, or null (invalid values are ignored) */
  function readResultParam() {
    let id = null;
    try {
      id = new URLSearchParams(location.search).get('result');
    } catch (e) {
      return null;
    }
    if (id === null) return null;
    if (resultById(id)) return id;
    setResultParam(null); // invalid → clean the URL and fall back to the start view
    return null;
  }

  /* =========================================================
   * 9. Share image (Canvas 1200×630)
   * ========================================================= */
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  const share = { id: null, dataUrl: null, file: null };

  /** Mix a #rrggbb color toward black (amount < 0) or white (amount > 0) */
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const target = amount < 0 ? 0 : 255;
    const k = Math.abs(amount);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * k));
    return 'rgb(' + c.join(',') + ')';
  }

  /** Break text into lines that fit maxWidth, wrapping between words */
  function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Largest font size (down to `min`) at which `text` fits maxWidth */
  function fitFont(ctx, text, weight, size, min, maxWidth) {
    for (; size > min; size -= 4) {
      ctx.font = weight + ' ' + size + 'px ' + FONT;
      if (ctx.measureText(text).width <= maxWidth) return;
    }
    ctx.font = weight + ' ' + min + 'px ' + FONT;
  }

  /** Shorten text with "…" until it fits maxWidth */
  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
    return text + '…';
  }

  function drawShareImage(r) {
    const W = 1200;
    const H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Background: diagonal gradient of the result color
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, shade(r.color, 0.15));
    g.addColorStop(1, shade(r.color, -0.35));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft decorative circles
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    [[1080, 90, 200], [980, 640, 160], [90, 600, 120]].forEach(([x, y, rad]) => {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    });

    // Emoji in a translucent disc on the left
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(250, 315, 175, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; // color emoji inherit fillStyle's alpha
    ctx.font = '200px ' + EMOJI_FONT;
    ctx.fillText(r.emoji, 250, 330);

    // Text on the right
    const x = 480;
    const maxW = W - x - 70;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 32px ' + FONT;
    ctx.fillText('Mini Games · Gamer Personality Quiz', x, 140);

    ctx.fillStyle = '#fff';
    ctx.font = '600 46px ' + FONT;
    ctx.fillText("I'm", x, 240);
    fitFont(ctx, r.title, '800', 100, 56, maxW);
    ctx.fillText(fitText(ctx, r.title, maxW), x, 355);

    ctx.font = '500 38px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    wrapLines(ctx, '“' + r.tagline + '”', maxW).slice(0, 2).forEach((line, i) => {
      ctx.fillText(line, x, 440 + i * 52);
    });

    ctx.font = '500 26px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    // The image invites people to take the quiz, so it shows the plain quiz URL
    const url = location.href.split(/[?#]/)[0].replace(/^https?:\/\//, '');
    ctx.fillText(fitText(ctx, 'What kind of gamer are you? → ' + url, maxW), x, 575);

    return canvas;
  }

  function prepareShareImage(r) {
    if (share.id === r.id && share.dataUrl) return;
    share.id = r.id;
    share.file = null;
    const canvas = drawShareImage(r);
    share.dataUrl = canvas.toDataURL('image/png');
    // A File (from the blob) is what navigator.share needs to attach the image
    if (canvas.toBlob && typeof File === 'function') {
      canvas.toBlob((blob) => {
        if (blob && share.id === r.id) share.file = new File([blob], 'quiz-' + r.id + '.png', { type: 'image/png' });
      }, 'image/png');
    }
  }

  /* =========================================================
   * 10. Share buttons
   * ========================================================= */
  function shareText(r) {
    return 'I got ' + r.emoji + ' ' + r.title + ' — "' + r.tagline + '" What kind of gamer are you? Take the quiz: ';
  }

  let toastTimer = 0;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1600);
  }

  /** Native share sheet (mobile): image + text + link when supported, else text + link */
  function shareNative() {
    const r = resultById(state.resultId);
    const url = shareUrl(r.id);
    track(EV.SHARE_CLICKED, { platform: 'native', result_type: r.id });
    const payload = { title: data.title, text: shareText(r) + url, url };
    if (share.file && navigator.canShare && navigator.canShare({ files: [share.file] })) {
      payload.files = [share.file];
    }
    navigator.share(payload).catch((err) => {
      if (err && err.name === 'AbortError') return; // user closed the sheet
      copyLink(false); // some in-app browsers expose share() but reject it
    });
  }

  /** Show the image full-screen: long-press to save (works in WeChat), or download */
  function shareImage() {
    const r = resultById(state.resultId);
    track(EV.SHARE_CLICKED, { platform: 'image', result_type: r.id });
    prepareShareImage(r);
    ui.shareImg.src = share.dataUrl;
    ui.btnDownload.href = share.dataUrl;
    ui.btnDownload.setAttribute('download', 'gamer-quiz-' + r.id + '.png');
    ui.shareOverlay.hidden = false;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for http:// / older WebViews
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error('copy failed'));
    });
  }

  let copyTimer = 0;
  function copyLink(fromButton) {
    const r = resultById(state.resultId);
    if (fromButton) track(EV.SHARE_CLICKED, { platform: 'copy', result_type: r.id });
    const label = ui.btnCopy.querySelector('span');
    copyToClipboard(shareText(r) + shareUrl(r.id)).then(
      () => {
        label.textContent = 'Copied!';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => (label.textContent = 'Copy Link'), 1500);
        toast('Link copied — go send it to your friends!');
      },
      () => toast('Copy failed — please copy the link from the address bar')
    );
  }

  /* =========================================================
   * 11. Events & boot
   * ========================================================= */
  function playSound(name) {
    if (window.Sound) window.Sound.play(name);
  }

  function restart() {
    setResultParam(null);
    startQuiz();
  }

  ui.btnStart.addEventListener('click', restart);
  ui.btnQuit.addEventListener('click', quitQuiz);
  ui.btnRetake.addEventListener('click', restart);
  ui.btnTake.addEventListener('click', restart);
  ui.options.addEventListener('click', (e) => {
    const btn = e.target.closest('.option');
    if (btn) onOptionTap(btn);
  });

  ui.btnShareNative.hidden = typeof navigator.share !== 'function';
  ui.btnShareNative.addEventListener('click', shareNative);
  ui.btnShareImage.addEventListener('click', shareImage);
  ui.btnCopy.addEventListener('click', () => copyLink(true));
  ui.btnOverlayClose.addEventListener('click', () => (ui.shareOverlay.hidden = true));
  ui.shareOverlay.addEventListener('click', (e) => {
    if (e.target === ui.shareOverlay) ui.shareOverlay.hidden = true; // tap outside closes
  });
  ui.btnReport.addEventListener('click', unlockReport);

  if (typeof window.showBanner === 'function') window.showBanner('ad-banner');

  // ?result= equal to the player's own last result (e.g. they reloaded the result
  // page) is shown as their own result, so their unlocked report stays visible
  const sharedId = readResultParam();
  if (sharedId) renderResult(sharedId, sharedScores(sharedId), sharedId !== storageGet(CONFIG.LAST_RESULT_KEY));
  else renderStart();
})();

