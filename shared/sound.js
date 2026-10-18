/* =========================================================
 * shared/sound.js — 音效
 * 用途：用 Web Audio API 现场合成简单音效，不需要任何音频文件。
 *       所有游戏共用，静音设置也全站共用（存在 localStorage）。
 *
 * 对外提供一个全局对象 Sound：
 *   Sound.play(name, params)  播放音效，name 见下方 SOUNDS
 *   Sound.toggle()            切换静音，返回切换后是否静音
 *   Sound.isMuted()           当前是否静音
 *   Sound.suspend()/resume()  暂停 / 恢复所有声音（例如播放真实广告期间）
 *
 * 注意：浏览器要求"用户操作后"才能出声，所以 AudioContext 在第一次
 *       点击/触摸时才创建；在此之前调用 play 会被直接忽略。
 * ========================================================= */

(function () {
  'use strict';

  var MUTE_KEY = 'sound_muted';
  var MASTER_VOLUME = 0.5;  // 总音量（0 ~ 1）
  var MIN_INTERVAL = 0.03;  // 同一种音效的最小间隔（秒），连锁合成时防止叠成噪音

  var ctx = null;       // AudioContext，首次用户操作时创建
  var master = null;    // 总音量节点
  var suspended = false;
  var lastPlay = {};    // 每种音效上次播放的时间

  var muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) {
    /* 隐私模式下可能不可用 */
  }

  /* ---------------- 初始化 / 解锁 ---------------- */

  function unlock() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // 浏览器不支持，静默跳过
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    }
    // iOS 上 AudioContext 必须在用户操作的回调里 resume 才能出声
    if (ctx.state === 'suspended' && !suspended && !document.hidden) {
      ctx.resume();
    }
  }
  // 用捕获阶段监听，保证比游戏自身的点击处理更早执行
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('touchend', unlock, true);

  // 切到后台时停止声音，回来后恢复
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (!suspended) ctx.resume();
  });

  /* ---------------- 基础发声 ---------------- */

  /**
   * 播放一个音
   * @param {object} o
   *   freq     起始频率（Hz）
   *   freqEnd  结束频率（可选，有则做滑音）
   *   type     波形：sine / triangle / square / sawtooth
   *   duration 时长（秒）
   *   volume   音量（0 ~ 1）
   *   delay    延迟多久开始（秒，可选）
   */
  function tone(o) {
    var t = ctx.currentTime + (o.delay || 0);
    var dur = o.duration;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);

    // 音量包络：快速起音 → 指数衰减，避免"啪"的爆音
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /**
   * 播放一段滤波后的白噪声（爆破、"噗"声这类没有明确音高的声音）
   * @param {object} o
   *   duration 时长（秒）
   *   volume   音量（0 ~ 1）
   *   filter   滤波类型：lowpass（闷）/ highpass（脆）/ bandpass
   *   freq     滤波频率（Hz）
   *   delay    延迟多久开始（秒，可选）
   */
  var noiseBuffer = null;
  function noise(o) {
    if (!noiseBuffer) {
      // 1 秒白噪声，生成一次反复用
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noiseBuffer.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t = ctx.currentTime + (o.delay || 0);
    var src = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    src.buffer = noiseBuffer;
    filter.type = o.filter || 'lowpass';
    filter.frequency.value = o.freq || 1000;
    gain.gain.setValueAtTime(o.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t, Math.random() * 0.5); // 随机起点，每次听起来略有不同
    src.stop(t + o.duration + 0.02);
  }

  /** 五声音阶上的第 step 个音（step 越大越高），基准音 G4 */
  var PENTATONIC = [0, 2, 4, 7, 9];
  function noteFreq(step) {
    var semitone = 12 * Math.floor(step / 5) + PENTATONIC[step % 5];
    return 392 * Math.pow(2, semitone / 12);
  }

  /* ---------------- 音效表（新增音效在这里加） ---------------- */

  var SOUNDS = {
    // 落球：短促的"噗"
    drop: function () {
      tone({ freq: 420, freqEnd: 160, type: 'sine', duration: 0.09, volume: 0.35 });
    },

    // 合成：数字越大、连击越多，音越高。params: { level, combo }
    merge: function (p) {
      var step = Math.min((p.level || 1) - 1 + ((p.combo || 1) - 1), 14);
      var f = noteFreq(step);
      tone({ freq: f, type: 'triangle', duration: 0.18, volume: 0.45 });
      tone({ freq: f * 2, type: 'sine', duration: 0.1, volume: 0.12 });
    },

    // 合成出大数字：额外加一段上行琶音
    big: function () {
      [0, 4, 7, 12].forEach(function (semi, i) {
        tone({ freq: 523 * Math.pow(2, semi / 12), type: 'triangle', duration: 0.25, volume: 0.25, delay: 0.06 * (i + 1) });
      });
    },

    // 游戏结束：下行音
    gameover: function () {
      [392, 330, 262, 196].forEach(function (f, i) {
        tone({ freq: f, type: 'triangle', duration: 0.28, volume: 0.35, delay: 0.14 * i });
      });
    },

    // 复活：上行音
    revive: function () {
      [262, 330, 392, 523].forEach(function (f, i) {
        tone({ freq: f, type: 'triangle', duration: 0.2, volume: 0.3, delay: 0.08 * i });
      });
    },

    // 倒计时最后一秒的"嘀"
    tick: function () {
      tone({ freq: 880, type: 'sine', duration: 0.05, volume: 0.15 });
    },

    // 棋子走一步：短促的"嗒"
    move: function () {
      tone({ freq: 700, freqEnd: 320, type: 'triangle', duration: 0.06, volume: 0.35 });
    },

    // 吃子：先一声重击再一声下滑
    capture: function () {
      tone({ freq: 220, freqEnd: 110, type: 'square', duration: 0.12, volume: 0.18 });
      tone({ freq: 660, freqEnd: 330, type: 'triangle', duration: 0.22, volume: 0.3, delay: 0.04 });
    },

    // 获胜：上行琶音 + 高音收尾
    win: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone({ freq: f, type: 'triangle', duration: 0.22, volume: 0.3, delay: 0.09 * i });
      });
      tone({ freq: 1568, type: 'sine', duration: 0.4, volume: 0.15, delay: 0.4 });
    },

    /* ----- 打气球 ----- */

    // 开枪：短促的"噗"（玩具枪的气流声，不是真枪声）
    shoot: function () {
      noise({ duration: 0.07, volume: 0.25, filter: 'lowpass', freq: 1400 });
      tone({ freq: 220, freqEnd: 90, type: 'sine', duration: 0.07, volume: 0.25 });
    },

    // 气球爆破：清脆的"啵"，每次音高随机
    pop: function () {
      var f = 650 + Math.random() * 450;
      noise({ duration: 0.09, volume: 0.35, filter: 'highpass', freq: 1800 });
      tone({ freq: f, freqEnd: f * 0.45, type: 'triangle', duration: 0.1, volume: 0.35 });
    },

    // 金气球：爆破声 + 一串上扬的"叮"
    popGold: function () {
      noise({ duration: 0.09, volume: 0.3, filter: 'highpass', freq: 1800 });
      [1047, 1319, 1568, 2093].forEach(function (f, i) {
        tone({ freq: f, type: 'sine', duration: 0.18, volume: 0.22, delay: 0.05 + 0.06 * i });
      });
    },

    // 炸弹气球：低沉的"咚"
    bomb: function () {
      tone({ freq: 140, freqEnd: 38, type: 'sine', duration: 0.45, volume: 0.6 });
      noise({ duration: 0.4, volume: 0.35, filter: 'lowpass', freq: 500 });
    },

    // 空枪（没打中）：轻轻的"咔哒"
    dryFire: function () {
      tone({ freq: 1800, type: 'square', duration: 0.02, volume: 0.08 });
      tone({ freq: 1100, type: 'square', duration: 0.025, volume: 0.06, delay: 0.035 });
    },

    // 换弹完成："咔-嚓"两声
    reload: function () {
      tone({ freq: 520, type: 'square', duration: 0.04, volume: 0.1 });
      noise({ duration: 0.05, volume: 0.15, filter: 'bandpass', freq: 2500, delay: 0.09 });
      tone({ freq: 900, type: 'square', duration: 0.04, volume: 0.1, delay: 0.1 });
    },

    /* ----- 挂机农场 ----- */

    // 种下：闷闷的"噗"（土被拍实）
    plant: function () {
      noise({ duration: 0.08, volume: 0.2, filter: 'lowpass', freq: 700 });
      tone({ freq: 300, freqEnd: 180, type: 'sine', duration: 0.1, volume: 0.3 });
    },

    // 收获：清脆的金币"叮"，音高略随机，连续收获不单调
    harvest: function () {
      var f = 1047 * Math.pow(2, (Math.floor(Math.random() * 3) * 2) / 12);
      tone({ freq: f, type: 'triangle', duration: 0.12, volume: 0.28 });
      tone({ freq: f * 1.5, type: 'sine', duration: 0.18, volume: 0.14, delay: 0.05 });
    },

    // 收集动物产出：两声"叮叮"
    collect: function () {
      tone({ freq: 880, type: 'triangle', duration: 0.1, volume: 0.26 });
      tone({ freq: 1319, type: 'triangle', duration: 0.16, volume: 0.24, delay: 0.08 });
    },

    // 购买 / 解锁 / 升级：短促上行三连音
    buy: function () {
      [659, 880, 1175].forEach(function (f, i) {
        tone({ freq: f, type: 'triangle', duration: 0.14, volume: 0.24, delay: 0.06 * i });
      });
    },

    // 钱不够：低沉的"嗡"
    deny: function () {
      tone({ freq: 180, freqEnd: 140, type: 'square', duration: 0.14, volume: 0.08 });
    },

    /* ----- 人格测试 ----- */

    // 选项点击：很轻的"嘀"
    tap: function () {
      tone({ freq: 660, freqEnd: 880, type: 'sine', duration: 0.07, volume: 0.18 });
    },

    // 结果揭晓：上扬的琶音 + 闪亮的高音
    reveal: function () {
      [392, 523, 659, 784, 1047].forEach(function (f, i) {
        tone({ freq: f, type: 'triangle', duration: 0.24, volume: 0.26, delay: 0.07 * i });
      });
      tone({ freq: 2093, type: 'sine', duration: 0.5, volume: 0.1, delay: 0.38 });
    },

    /* ----- Brick Builder ----- */

    // Brick snaps into place: crisp plastic "click" (noise tick + short high blip)
    snap: function () {
      noise({ duration: 0.04, volume: 0.35, filter: 'highpass', freq: 3000 });
      tone({ freq: 1400, freqEnd: 900, type: 'square', duration: 0.05, volume: 0.07 });
      tone({ freq: 2200, type: 'sine', duration: 0.06, volume: 0.1, delay: 0.02 });
    },

    // Wrong spot: short low "boop"
    wrong: function () {
      tone({ freq: 220, freqEnd: 150, type: 'triangle', duration: 0.16, volume: 0.28 });
    },

    // Hint revealed: two soft sparkly notes
    hint: function () {
      tone({ freq: 1047, type: 'sine', duration: 0.18, volume: 0.16 });
      tone({ freq: 1568, type: 'sine', duration: 0.3, volume: 0.14, delay: 0.1 });
    },

    // Star counted on the results screen: bright ding, a step higher for each star (params.n = 1, 2, 3...)
    star: function (p) {
      var f = 880 * Math.pow(2, Math.min((p.n || 1) - 1, 8) * 2 / 12);
      tone({ freq: f, type: 'triangle', duration: 0.18, volume: 0.22 });
      tone({ freq: f * 2, type: 'sine', duration: 0.25, volume: 0.08, delay: 0.03 });
    },

    // Model finished: rising arpeggio ending on a bright chord
    complete: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone({ freq: f, type: 'triangle', duration: 0.22, volume: 0.24, delay: 0.08 * i });
      });
      [1047, 1319, 1568].forEach(function (f) {
        tone({ freq: f, type: 'sine', duration: 0.6, volume: 0.1, delay: 0.34 });
      });
    }
  };

  /* ---------------- 对外接口 ---------------- */

  function play(name, params) {
    if (muted || suspended || !ctx || ctx.state !== 'running') return;
    var fn = SOUNDS[name];
    if (!fn) return;

    var now = ctx.currentTime;
    if (lastPlay[name] && now - lastPlay[name] < MIN_INTERVAL) return;
    lastPlay[name] = now;

    fn(params || {});
  }

  function toggle() {
    muted = !muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (e) {
      /* 忽略 */
    }
    return muted;
  }

  window.Sound = {
    play: play,
    toggle: toggle,
    isMuted: function () { return muted; },
    suspend: function () {
      suspended = true;
      if (ctx) ctx.suspend();
    },
    resume: function () {
      suspended = false;
      if (ctx && !document.hidden) ctx.resume();
    }
  };
})();
