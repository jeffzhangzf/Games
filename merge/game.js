/* =========================================================
 * merge/game.js — "合成数字"游戏逻辑
 * 用途：基于 Phaser 3 + Matter.js 的物理合成玩法
 *   - 点击屏幕，在点击的 X 位置从顶部掉落一个数字球
 *   - 相同数字的球相撞 → 合成为 2 倍的数字（1+1=2, 2+2=4 ...）
 *   - 有球停在警戒线以上超过一定时间 → 游戏结束
 *   - 4 档难度：简单 / 普通 / 困难 / 地狱，每档单独记录最高分
 *   - 手感：合成弹出动画、粒子、飘分、连击、大数字震屏、下一个球预告、音效
 *   - 体验：加载页、首次引导、切后台/失焦自动暂停、新纪录动画
 *
 * localStorage 键名：
 *   merge_best_score_<难度>   各难度最高分（easy / normal / hard / hell）
 *   merge_difficulty          上次选择的难度
 *   merge_tutorial_seen       是否看过首次引导（"1" = 看过）
 *   sound_muted               全站静音设置（shared/sound.js）
 *
 * 依赖（在 index.html 中按顺序引入）：
 *   Phaser 3（CDN）→ shared/analytics.js → shared/ads.js → shared/sound.js → 本文件
 *
 * 关于坐标单位：
 *   为了在高清屏上不模糊，画布按"屏幕实际像素"创建（CSS 尺寸 × 设备像素比）。
 *   所有尺寸都以"400 宽的设计稿"为基准，再乘以缩放系数 S，
 *   这样无论手机大小，游戏看起来和玩起来都一样。
 * ========================================================= */

/* =========================================================
 * 1. 通用参数（所有难度共用）
 * ========================================================= */
const CONFIG = {
  BASE_WIDTH: 400,        // 设计稿宽度，所有尺寸以此为基准
  RADIUS_GROWTH: 1.15,    // 数字每翻一倍，半径放大 15%
  MAX_RADIUS: 160,        // 半径上限（设计稿单位），防止超大数字把容器撑满
  DROP_COOLDOWN: 500,     // 掉落冷却（毫秒），防止连点
  NEW_BALL_GRACE: 1000,   // 新球（刚掉落/刚合成）的免检时间（毫秒），否则刚掉下的球一出生就在线上
  REVIVE_REMOVE_COUNT: 3, // 复活时消除最上面的几个球
  GRAVITY: 1.4,           // 重力强度
  MAX_DPR: 2,             // 设备像素比上限，太高会影响性能
  HUD_HEIGHT: 56,         // 顶部分数栏高度（CSS 像素），⚠ 与 index.html 中 #hud 的 height 一致

  // 手感 / 特效
  COMBO_WINDOW: 1000,     // 两次合成间隔小于这个时间（毫秒）算连击（只是视觉和音效，不影响得分）
  SHAKE_FROM: 128,        // 合成出的数字 >= 这个值时震屏
  MILESTONE_FROM: 64,     // 本局首次合成出 >= 这个值的数字时，屏幕中央弹出提示

  // 球的物理属性
  BALL_PHYSICS: {
    restitution: 0.15,    // 弹性（0 不弹，1 完全弹）
    friction: 0.05,       // 摩擦力
    frictionStatic: 0.3,  // 静摩擦
    frictionAir: 0.012,   // 空气阻力
    density: 0.001        // 密度
  },

  BEST_SCORE_KEY: 'merge_best_score_', // 最高分在 localStorage 中的键名前缀（后面接难度名）
  DIFFICULTY_KEY: 'merge_difficulty',  // 上次选择的难度
  TUTORIAL_KEY: 'merge_tutorial_seen', // 是否看过首次引导
  TUTORIAL_MAX_MS: 12000               // 首次引导最多显示多久（第一次合成后也会消失）
};

/* =========================================================
 * 2. 难度配置（想调某一档的难度，改这里即可）
 *
 *   baseRadius    数字 1 的球半径（设计稿单位，400 宽：28 = 7%、32 = 8%、36 = 9%）
 *   spawn         掉落数字表：value 数字 / weight 权重（越大越常出现）/
 *                 unlockAt 本局合成出的最大数字达到多少后才开始掉落（0 = 开局就有）
 *   autoDrop      限时掉落（毫秒）：超时没点击，球会在当前位置自动掉下；0 = 不限时
 *   gameOverDelay 球在警戒线以上持续多久判定失败（毫秒）
 * ========================================================= */
const DIFFICULTIES = {
  easy: {
    name: 'Easy',
    desc: 'No timer, take your time',
    baseRadius: 28,
    spawn: [
      { value: 1,  weight: 25, unlockAt: 0 },
      { value: 2,  weight: 25, unlockAt: 0 },
      { value: 4,  weight: 20, unlockAt: 0 },
      { value: 8,  weight: 18, unlockAt: 64 },
      { value: 16, weight: 12, unlockAt: 256 }
    ],
    autoDrop: 0,
    gameOverDelay: 2000
  },
  normal: {
    name: 'Normal',
    desc: 'Drop within 5 seconds',
    baseRadius: 32,
    spawn: [
      { value: 1,  weight: 25, unlockAt: 0 },
      { value: 2,  weight: 25, unlockAt: 0 },
      { value: 4,  weight: 20, unlockAt: 0 },
      { value: 8,  weight: 18, unlockAt: 0 },
      { value: 16, weight: 12, unlockAt: 128 }
    ],
    autoDrop: 5000,
    gameOverDelay: 2000
  },
  hard: {
    name: 'Hard',
    desc: '3-second timer, messier numbers',
    baseRadius: 36,
    spawn: [
      { value: 1,  weight: 22, unlockAt: 0 },
      { value: 2,  weight: 22, unlockAt: 0 },
      { value: 4,  weight: 18, unlockAt: 0 },
      { value: 8,  weight: 16, unlockAt: 0 },
      { value: 16, weight: 14, unlockAt: 0 },
      { value: 32, weight: 8,  unlockAt: 256 }
    ],
    autoDrop: 3000,
    gameOverDelay: 1500
  },
  hell: {
    name: 'Insane',
    desc: '2-second timer, 1 second over the line and you lose',
    baseRadius: 36,
    spawn: [
      { value: 1,  weight: 18, unlockAt: 0 },
      { value: 2,  weight: 18, unlockAt: 0 },
      { value: 4,  weight: 17, unlockAt: 0 },
      { value: 8,  weight: 16, unlockAt: 0 },
      { value: 16, weight: 14, unlockAt: 0 },
      { value: 32, weight: 11, unlockAt: 0 },
      { value: 64, weight: 6,  unlockAt: 256 }
    ],
    autoDrop: 2000,
    gameOverDelay: 1000
  }
};
const DEFAULT_DIFFICULTY = 'normal';

/* =========================================================
 * 3. 配色：暖色渐进  浅橙 → 橙红 → 紫蓝 → 金色
 *    数字是白色的，所以颜色都选了中等偏深的饱和色，保证文字清晰
 * ========================================================= */
const COLORS = {
  1:    '#F6B26B', // 浅橙
  2:    '#F4A04F', // 橙
  4:    '#F28A3E', // 深橙
  8:    '#EF6F50', // 橙红
  16:   '#E85A4F', // 珊瑚红
  32:   '#D9455F', // 玫红
  64:   '#C2366F', // 洋红
  128:  '#9B5DE5', // 紫
  256:  '#7B61FF', // 蓝紫
  512:  '#4D7CFE', // 蓝
  1024: '#F2B705', // 金
  2048: '#E09F00'  // 深金
};
const COLOR_MAX = '#D4A017'; // 4096 及以上统一使用的金色

/** 根据数字取颜色（CSS 字符串，如 '#F6B26B'） */
function colorOf(value) {
  return COLORS[value] || COLOR_MAX;
}

/** 根据数字取颜色（Phaser 用的整数，如 0xF6B26B） */
function colorIntOf(value) {
  return parseInt(colorOf(value).slice(1), 16);
}

/** 画布上文字统一使用的字体 */
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", Arial, sans-serif';

// Phaser 没加载到时（CDN 失败），index.html 已经显示了提示，这里直接停止，避免一串报错
if (!window.Phaser) throw new Error('[merge] Phaser failed to load');

// 音效脚本没加载到时，用一个什么都不做的替身顶上：游戏照常运行，只是没声音
if (!window.Sound) {
  console.warn('[merge] shared/sound.js failed to load, no sound this game');
  window.Sound = { play() {}, toggle() { return true; }, isMuted() { return true; }, suspend() {}, resume() {} };
}

/* =========================================================
 * 4. 计算画布尺寸
 * ========================================================= */
const appEl = document.getElementById('app');
const DPR = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
const GAME_W = Math.round(appEl.clientWidth * DPR);  // 画布宽（实际像素）
const GAME_H = Math.round(appEl.clientHeight * DPR); // 画布高（实际像素）
const S = GAME_W / CONFIG.BASE_WIDTH; // 缩放系数：设计稿尺寸 × S = 画布尺寸

/* =========================================================
 * 5. 工具函数
 * ========================================================= */

/** 某难度下，数字对应的球半径（画布像素） */
function radiusOf(value, diff) {
  const level = Math.log2(value); // 1→0, 2→1, 4→2 ...
  const r = diff.baseRadius * Math.pow(CONFIG.RADIUS_GROWTH, level);
  return Math.min(r, CONFIG.MAX_RADIUS) * S;
}

/**
 * 按权重随机一个掉落数字
 * @param {object} diff       当前难度配置
 * @param {number} maxReached 本局合成出的最大数字，用来判断哪些数字已解锁
 */
function randomSpawnValue(diff, maxReached) {
  const list = diff.spawn.filter((item) => maxReached >= item.unlockAt);
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of list) {
    roll -= item.weight;
    if (roll < 0) return item.value;
  }
  return list[0].value;
}

/** localStorage 读写（隐私模式下可能不可用，所以都包一层 try） */
function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function storageSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    /* 忽略 */
  }
}

/** 读取某个难度的最高分 */
function loadBest(diffKey) {
  return parseInt(storageGet(CONFIG.BEST_SCORE_KEY + diffKey), 10) || 0;
}

/** 读取上次选择的难度 */
function loadLastDifficulty() {
  const key = storageGet(CONFIG.DIFFICULTY_KEY);
  return DIFFICULTIES[key] ? key : DEFAULT_DIFFICULTY;
}

/* =========================================================
 * 6. 页面上的 DOM 元素（分数栏、弹窗）
 * ========================================================= */
const ui = {
  loading: document.getElementById('loading'),
  tutorial: document.getElementById('tutorial'),
  pauseModal: document.getElementById('pause-modal'),
  btnResume: document.getElementById('btn-resume'),
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  diffName: document.getElementById('diff-name'),
  nextBall: document.getElementById('next-ball'),
  btnMute: document.getElementById('btn-mute'),
  modal: document.getElementById('modal'),
  finalScore: document.getElementById('final-score'),
  finalBest: document.getElementById('final-best'),
  finalDiff: document.getElementById('final-diff'),
  finalMax: document.getElementById('final-max'),
  newRecord: document.getElementById('new-record'),
  btnRevive: document.getElementById('btn-revive'),
  btnRestart: document.getElementById('btn-restart'),
  btnChangeDiff: document.getElementById('btn-change-diff'),
  diffModal: document.getElementById('diff-modal'),
  diffList: document.getElementById('diff-list')
};

/* =========================================================
 * 7. 游戏场景
 * ========================================================= */
class MergeScene extends Phaser.Scene {
  constructor() {
    super('MergeScene');
  }

  /** 场景创建：只执行一次，搭建容器、绑定事件。真正开局要等玩家选完难度 */
  create() {
    const W = GAME_W;
    const H = GAME_H;

    this.floorY = H - 12 * DPR; // 地板顶部

    // ---------- 容器：左墙、右墙、地板（静态刚体，放在画面外侧） ----------
    const T = 200 * S; // 墙的厚度，做厚一点防止高速球穿墙
    const wallOpts = { isStatic: true, friction: 0.1, label: 'wall' };
    this.matter.add.rectangle(-T / 2, H / 2, T, H * 3, wallOpts);        // 左墙
    this.matter.add.rectangle(W + T / 2, H / 2, T, H * 3, wallOpts);     // 右墙
    this.matter.add.rectangle(W / 2, this.floorY + T / 2, W + T * 2, T, wallOpts); // 地板

    // ---------- 背景装饰 ----------
    // 地板色块
    this.add.rectangle(W / 2, (this.floorY + H) / 2, W, H - this.floorY, 0xe9dcc8);

    // 瞄准辅助线（预览球正下方的一条淡竖线）
    this.guideLine = this.add.graphics();

    // 警戒线：灰色常态 + 红色警告（有球越线时闪烁）。位置随难度变化，在 applyLayout 中绘制
    this.dangerLine = this.add.graphics();
    this.dangerLineRed = this.add.graphics();
    this.dangerLineRed.setVisible(false);

    // ---------- 预览球（顶部待掉落的球，不参与物理） ----------
    this.preview = this.add.image(W / 2, 0, '__DEFAULT').setVisible(false);
    this.preview.setDepth(10);

    // 限时掉落的倒计时圆环（围绕预览球）
    this.timerRing = this.add.graphics().setDepth(11);

    // ---------- 特效用的素材 ----------
    // 粒子：一个白色小圆点纹理，使用时再染成球的颜色
    const dotR = Math.max(2, Math.round(5 * S));
    const dot = this.make.graphics({ add: false });
    dot.fillStyle(0xffffff, 1);
    dot.fillCircle(dotR, dotR, dotR);
    dot.generateTexture('fx_dot', dotR * 2, dotR * 2);
    dot.destroy();

    // 连击提示 & 新数字提示（各只有一个，反复复用）
    const textStyle = (size) => ({
      fontFamily: FONT_FAMILY,
      fontSize: Math.round(size * S) + 'px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#ffffff',
      strokeThickness: Math.round(6 * S)
    });
    this.comboText = this.add.text(W / 2, 0, '', textStyle(26)).setOrigin(0.5).setDepth(20).setAlpha(0);
    this.milestoneText = this.add.text(W / 2, H * 0.42, '', textStyle(40)).setOrigin(0.5).setDepth(20).setAlpha(0);

    // ---------- 碰撞监听：相同数字的球相撞 → 记录下来，在 update 中统一合成 ----------
    // （不在碰撞回调里直接删除刚体，避免物理引擎计算中途出错）
    // collisionactive：已经贴在一起的两个球也要检查。例如 A 和 B 接触时 B 正忙着和 C 合成，
    // 只监听 collisionstart 的话，之后 A 和 B 就再也不会合成了
    const onCollision = (event) => {
      for (const pair of event.pairs) {
        this.checkMerge(pair.bodyA.gameObject, pair.bodyB.gameObject);
      }
    };
    this.matter.world.on('collisionstart', onCollision);
    this.matter.world.on('collisionactive', onCollision);

    // ---------- 输入：移动时预览球跟随，按下时掉落 ----------
    this.input.mouse && this.input.mouse.disableContextMenu();
    this.input.on('pointermove', (pointer) => {
      if (this.preview.visible) this.movePreview(pointer.x);
    });
    this.input.on('pointerdown', (pointer) => this.dropBall(pointer.x));

    // ---------- 初始状态：等待选择难度 ----------
    this.balls = new Set();      // 场上所有的数字球
    this.pendingMerges = [];     // 待合成的球对
    this.roundId = 0;            // 局号：用来作废上一局遗留的延时任务
    this.isOver = true;          // 选难度之前不允许掉球
    this.matter.world.pause();

    // 场景画好了：淡出加载页
    ui.loading.classList.add('done');
    setTimeout(() => ui.loading.remove(), 400);

    showDifficultyPicker();
  }

  /**
   * 开始新的一局
   * @param {string} diffKey 难度名：easy / normal / hard / hell
   */
  startGame(diffKey) {
    this.diffKey = diffKey;
    this.diff = DIFFICULTIES[diffKey];
    this.best = loadBest(diffKey);
    storageSet(CONFIG.DIFFICULTY_KEY, diffKey);

    // 清空场上的球
    for (const ball of this.balls) ball.destroy();
    this.balls.clear();
    this.pendingMerges.length = 0;

    this.roundId++;
    this.score = 0;
    this.maxReached = 0;           // 本局合成出的最大数字（用于解锁更大的掉落数字）
    this.revived = false;          // 本局是否已经复活过（每局只能复活 1 次）
    this.isOver = false;
    this.lastDropTime = -Infinity; // 上次掉落时间，用于冷却
    this.combo = 0;                // 当前连击数
    this.lastMergeTime = -Infinity;
    ui.diffName.textContent = this.diff.name;
    this.updateScoreUI();

    this.applyLayout();
    this.comboText.setAlpha(0);
    this.milestoneText.setAlpha(0);

    // 准备第一个预览球和"下一个"
    this.currentValue = randomSpawnValue(this.diff, this.maxReached);
    this.nextValue = randomSpawnValue(this.diff, this.maxReached);
    this.updateNextUI();
    this.showPreview(GAME_W / 2);

    this.dangerLineRed.setVisible(false);
    this.matter.world.resume();

    trackEvent(EVENTS.GAME_START, { game: 'merge', difficulty: diffKey });

    // 首次引导：从没看过时显示，第一次合成或超时后关闭
    this.tutorialOn = !storageGet(CONFIG.TUTORIAL_KEY);
    ui.tutorial.classList.toggle('hidden', !this.tutorialOn);
    if (this.tutorialOn) {
      const roundId = this.roundId;
      this.time.delayedCall(CONFIG.TUTORIAL_MAX_MS, () => {
        if (roundId === this.roundId) this.endTutorial();
      });
    }
  }

  /** 关闭首次引导，并记住已经看过 */
  endTutorial() {
    if (!this.tutorialOn) return;
    this.tutorialOn = false;
    ui.tutorial.classList.add('hidden');
    storageSet(CONFIG.TUTORIAL_KEY, '1');
  }

  /** 根据当前难度计算掉落高度和警戒线位置（球越大，顶部需要留的空间越大） */
  applyLayout() {
    // 当前难度能掉落的最大球的半径
    const maxSpawnValue = Math.max(...this.diff.spawn.map((item) => item.value));
    const maxSpawnR = radiusOf(maxSpawnValue, this.diff);

    const hudBottom = CONFIG.HUD_HEIGHT * DPR;           // 分数栏底部
    this.spawnY = hudBottom + maxSpawnR + 8 * S;         // 掉落起点（预览球所在高度）
    this.dangerY = this.spawnY + maxSpawnR + 10 * S;     // 警戒线（在最大预览球下方）

    this.dangerLine.clear();
    this.drawDashedLine(this.dangerLine, this.dangerY, 0xb2a48f, 0.8);
    this.dangerLineRed.clear();
    this.drawDashedLine(this.dangerLineRed, this.dangerY, 0xe74c3c, 1);
    this.preview.y = this.spawnY;
  }

  /* ---------------- 球的纹理 & 创建 ---------------- */

  /**
   * 获取某个数字的球的纹理（首次使用时用 Canvas 现画一张并缓存）
   * 纯色圆形 + 白色数字 + 一点高光，不需要图片资源
   * 不同难度的球大小不同，所以缓存键里带上半径
   */
  ballTexture(value) {
    const r = radiusOf(value, this.diff);
    const key = 'ball_' + value + '_' + Math.round(r);
    if (this.textures.exists(key)) return key;

    const size = Math.ceil(r * 2) + 4; // 留 2px 边距，防止边缘被裁掉
    const c = size / 2;                // 圆心
    const tex = this.textures.createCanvas(key, size, size);
    const ctx = tex.getContext();

    // 圆形底色
    ctx.fillStyle = colorOf(value);
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();

    // 左上角一小块高光，让球更有立体感
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(c - r * 0.3, c - r * 0.35, r * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // 白色数字：位数越多字号越小，保证放得下
    const text = String(value);
    const ratio = text.length <= 2 ? 0.95 : text.length === 3 ? 0.72 : 0.56;
    const fontSize = Math.round(r * ratio);
    ctx.font = 'bold ' + fontSize + 'px ' + FONT_FAMILY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fontSize * 0.12;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'; // 淡淡的描边，浅色球上也看得清
    ctx.strokeText(text, c, c + fontSize * 0.05);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, c, c + fontSize * 0.05);

    tex.refresh(); // 通知 Phaser 纹理已更新
    return key;
  }

  /**
   * 在 (x, y) 创建一个带物理效果的数字球
   * @param {boolean} [pop] 是否播放"弹出"动画（合成出的新球用）
   */
  createBall(x, y, value, pop) {
    const r = radiusOf(value, this.diff);
    const ball = this.matter.add.image(x, y, this.ballTexture(value), null, {
      shape: { type: 'circle', radius: r },
      label: 'ball',
      ...CONFIG.BALL_PHYSICS
    });
    ball.setData({
      value: value,
      radius: r,
      age: 0,        // 出生后经过的时间（毫秒），用于免检期
      overTime: 0,   // 连续停在警戒线以上的时间（毫秒）
      merging: false // 是否已经在等待合成（防止一个球同时和两个球合成）
    });
    this.balls.add(ball);
    if (pop) this.popIn(ball);
    return ball;
  }

  /**
   * 弹出动画：从小变大。
   * 直接缩放物理球会连带缩放碰撞体，导致物理抖动，所以这里把真球先藏起来，
   * 用一张跟随真球位置的"替身"图片做缩放动画，动画结束再换回真球。
   */
  popIn(ball) {
    ball.setVisible(false);
    const ghost = this.add.image(ball.x, ball.y, ball.texture.key).setScale(0.5);
    this.tweens.add({
      targets: ghost,
      scale: 1,
      duration: 220,
      ease: 'Back.easeOut',
      onUpdate: () => {
        if (ball.active) ghost.setPosition(ball.x, ball.y).setRotation(ball.rotation);
        else ghost.setVisible(false); // 真球在动画中途又被合成掉了
      },
      onComplete: () => {
        ghost.destroy();
        if (ball.active) ball.setVisible(true);
      }
    });
  }

  /** 移除一个球 */
  removeBall(ball) {
    this.balls.delete(ball);
    ball.destroy();
  }

  /* ---------------- 预览 & 掉落 ---------------- */

  /** 把 x 限制在容器内，保证球不会卡进墙里 */
  clampX(x, value) {
    const r = radiusOf(value, this.diff);
    return Phaser.Math.Clamp(x, r + 1, GAME_W - r - 1);
  }

  /** 显示预览球（冷却结束后调用），同时开始限时倒计时 */
  showPreview(x) {
    this.preview.setTexture(this.ballTexture(this.currentValue));
    this.preview.setVisible(true);
    this.autoDropLeft = this.diff.autoDrop; // 0 表示不限时
    this.lastTick = -1;                     // 最后一秒"嘀"声的计数
    this.movePreview(x);
  }

  /** 预览球跟随手指/鼠标的 X 坐标，并画出瞄准线 */
  movePreview(x) {
    const px = this.clampX(x, this.currentValue);
    this.preview.x = px;

    this.guideLine.clear();
    this.guideLine.lineStyle(2 * DPR, 0x000000, 0.07);
    this.guideLine.lineBetween(px, this.spawnY, px, this.floorY);
  }

  /** 点击屏幕：在点击的 X 坐标掉落当前球 */
  dropBall(x) {
    if (this.isOver || !this.preview.visible) return;

    // 冷却中，忽略这次点击
    const now = this.time.now;
    if (now - this.lastDropTime < CONFIG.DROP_COOLDOWN) return;
    this.lastDropTime = now;

    const value = this.currentValue;
    const px = this.clampX(x, value);
    this.createBall(px, this.spawnY, value);
    Sound.play('drop');

    // 隐藏预览球和倒计时，冷却结束后再显示下一个
    this.preview.setVisible(false);
    this.guideLine.clear();
    this.timerRing.clear();
    this.currentValue = this.nextValue;
    this.nextValue = randomSpawnValue(this.diff, this.maxReached);
    this.updateNextUI();
    const roundId = this.roundId;
    this.time.delayedCall(CONFIG.DROP_COOLDOWN, () => {
      // 局号不同说明已经重开/换难度，这个延时任务作废
      if (!this.isOver && roundId === this.roundId) this.showPreview(px);
    });
  }

  /** 限时掉落：倒计时 + 画圆环，时间到自动在当前位置落球 */
  updateAutoDrop(delta) {
    if (!this.diff.autoDrop || !this.preview.visible) return;

    this.autoDropLeft -= delta;
    if (this.autoDropLeft <= 0) {
      this.dropBall(this.preview.x);
      return;
    }

    // 最后 1 秒每 250 毫秒"嘀"一声
    if (this.autoDropLeft < 1000) {
      const tick = Math.floor(this.autoDropLeft / 250);
      if (tick !== this.lastTick) {
        this.lastTick = tick;
        Sound.play('tick');
      }
    }

    // 圆环表示剩余时间：满圈 → 空圈；最后 1 秒变红
    const frac = this.autoDropLeft / this.diff.autoDrop;
    const color = this.autoDropLeft < 1000 ? 0xe74c3c : 0x7f8c8d;
    const r = radiusOf(this.currentValue, this.diff) + 6 * S;
    const start = -Math.PI / 2; // 从 12 点方向开始
    this.timerRing.clear();
    this.timerRing.lineStyle(3 * S, color, 0.9);
    this.timerRing.beginPath();
    this.timerRing.arc(this.preview.x, this.spawnY, r, start, start + Math.PI * 2 * frac, false);
    this.timerRing.strokePath();
  }

  /* ---------------- 合成 ---------------- */

  /** 碰撞时检查两个物体是否可以合成 */
  checkMerge(a, b) {
    // 必须两个都是场上的数字球（排除墙、地板）
    if (!a || !b || !this.balls.has(a) || !this.balls.has(b)) return;
    // 数字必须相同
    if (a.getData('value') !== b.getData('value')) return;
    // 任意一个已在等待合成，就跳过
    if (a.getData('merging') || b.getData('merging')) return;

    a.setData('merging', true);
    b.setData('merging', true);
    this.pendingMerges.push([a, b]);
  }

  /** 执行所有待合成的球对 */
  processMerges() {
    for (const [a, b] of this.pendingMerges) {
      if (!a.active || !b.active) {
        // 其中一个已经被移除了：把另一个的标记清掉，否则它永远不能再合成
        if (a.active) a.setData('merging', false);
        if (b.active) b.setData('merging', false);
        continue;
      }

      const newValue = a.getData('value') * 2;
      const r = radiusOf(newValue, this.diff);

      // 新球出现在两球中点，继承平均速度；并限制在容器内，防止和墙重叠被弹飞
      const x = Phaser.Math.Clamp((a.x + b.x) / 2, r + 1, GAME_W - r - 1);
      const y = Math.min((a.y + b.y) / 2, this.floorY - r - 1);
      const vx = (a.body.velocity.x + b.body.velocity.x) / 2;
      const vy = (a.body.velocity.y + b.body.velocity.y) / 2;

      this.removeBall(a);
      this.removeBall(b);
      const ball = this.createBall(x, y, newValue, true);
      ball.setVelocity(vx, vy);

      // 连击：距离上次合成不到 COMBO_WINDOW 毫秒
      const now = this.time.now;
      this.combo = now - this.lastMergeTime < CONFIG.COMBO_WINDOW ? this.combo + 1 : 1;
      this.lastMergeTime = now;

      const isNewMax = newValue > this.maxReached;
      this.maxReached = Math.max(this.maxReached, newValue);
      this.addScore(newValue);
      this.playMergeFx(x, y, newValue, isNewMax);
      this.endTutorial(); // 学会合成了
      trackEvent(EVENTS.MERGE, { value: newValue });
    }
    this.pendingMerges.length = 0;
  }

  /* ---------------- 合成特效 ---------------- */

  /**
   * 合成时的全部反馈：光圈、粒子、飘分、连击、新数字提示、震屏、音效
   * @param {boolean} isNewMax 是否是本局第一次合成出这么大的数字
   */
  playMergeFx(x, y, value, isNewMax) {
    const color = colorIntOf(value);
    const r = radiusOf(value, this.diff);
    const level = Math.log2(value);

    // 1. 向外扩散的光圈
    const ring = this.add.circle(x, y, r, 0xffffff, 0).setStrokeStyle(4 * S, color).setDepth(5);
    this.tweens.add({
      targets: ring,
      scale: 1.5,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy()
    });

    // 2. 四散的粒子：数字越大粒子越多
    const count = Math.min(6 + level, 16);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = r * (1.1 + Math.random() * 0.7);
      const p = this.add.image(x, y, 'fx_dot')
        .setTint(color)
        .setDepth(5)
        .setScale(0.6 + Math.random() * 0.6);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.2,
        duration: 350 + Math.random() * 200,
        ease: 'Cubic.easeOut',
        onComplete: () => p.destroy()
      });
    }

    // 3. 飘分 "+N"
    const txt = this.add.text(x, y - r * 0.3, '+' + value, {
      fontFamily: FONT_FAMILY,
      fontSize: Math.round(18 * S) + 'px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: colorOf(value),
      strokeThickness: Math.round(5 * S)
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({
      targets: txt,
      y: txt.y - r - 30 * S,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => txt.destroy()
    });

    // 4. 连击提示
    if (this.combo >= 2) {
      this.flashText(this.comboText, 'Combo ×' + this.combo, '#e85a4f', this.dangerY + 40 * S, 600);
    }

    // 5. 本局第一次合成出大数字
    if (isNewMax && value >= CONFIG.MILESTONE_FROM) {
      this.flashText(this.milestoneText, 'Made ' + value + '!', colorOf(value), GAME_H * 0.42, 900);
    }

    // 6. 大数字震屏（越大震得越厉害）
    if (value >= CONFIG.SHAKE_FROM) {
      const intensity = Math.min(0.003 + 0.0015 * (level - 7), 0.01);
      this.cameras.main.shake(180, intensity);
    }

    // 7. 音效
    Sound.play('merge', { level: level, combo: this.combo });
    if (value >= CONFIG.SHAKE_FROM) Sound.play('big');
  }

  /**
   * 让一个提示文字"弹出 → 停留 → 淡出"
   * @param {number} hold 停留时间（毫秒）
   */
  flashText(textObj, content, color, y, hold) {
    this.tweens.killTweensOf(textObj);
    textObj.setText(content).setColor(color).setY(y).setAlpha(1).setScale(0.6);
    this.tweens.add({ targets: textObj, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: textObj, alpha: 0, delay: hold, duration: 300 });
  }

  /* ---------------- 分数 ---------------- */

  /** 加分：分数 = 所有合成出来的数字之和 */
  addScore(points) {
    this.score += points;
    if (this.score > this.best) {
      this.best = this.score;
      storageSet(CONFIG.BEST_SCORE_KEY + this.diffKey, this.best); // 实时保存，中途关闭页面也不会丢
    }
    this.updateScoreUI();
  }

  updateScoreUI() {
    ui.score.textContent = this.score;
    ui.best.textContent = this.best;
    if (this.score > 0) {
      // 重新触发 CSS 动画：先去掉 class，强制重排，再加回来
      ui.score.classList.remove('bump');
      void ui.score.offsetWidth;
      ui.score.classList.add('bump');
    }
  }

  /** 更新顶部"下一个"球的预告 */
  updateNextUI() {
    ui.nextBall.textContent = this.nextValue;
    ui.nextBall.style.background = colorOf(this.nextValue);
  }

  /* ---------------- 每帧更新 ---------------- */

  update(time, delta) {
    if (this.isOver) return;

    this.processMerges();
    this.updateAutoDrop(delta);

    // 检查是否有球停在警戒线以上
    let anyOver = false;
    for (const ball of this.balls) {
      const age = ball.getData('age') + delta;
      ball.setData('age', age);
      if (age < CONFIG.NEW_BALL_GRACE) continue; // 新球免检

      const top = ball.y - ball.getData('radius'); // 球的顶部
      if (top < this.dangerY) {
        const overTime = ball.getData('overTime') + delta;
        ball.setData('overTime', overTime);
        anyOver = true;
        if (overTime >= this.diff.gameOverDelay) {
          this.gameOver();
          return;
        }
      } else {
        ball.setData('overTime', 0);
      }
    }

    // 有球越线时，红色警戒线闪烁提醒
    this.dangerLineRed.setVisible(anyOver);
    if (anyOver) {
      this.dangerLineRed.setAlpha(0.5 + 0.5 * Math.sin(time / 80));
    }
  }

  /* ---------------- 游戏结束 ---------------- */

  gameOver() {
    this.isOver = true;
    this.matter.world.pause(); // 冻结物理世界
    this.preview.setVisible(false);
    this.guideLine.clear();
    this.timerRing.clear();
    this.dangerLineRed.setVisible(true).setAlpha(1);
    this.cameras.main.shake(250, 0.006);
    this.endTutorial();
    const isNewRecord = this.score > 0 && this.score >= this.best;
    Sound.play(isNewRecord ? 'win' : 'gameover');

    trackEvent(EVENTS.GAME_END, { game: 'merge', difficulty: this.diffKey, score: this.score });

    // 显示结束弹窗
    ui.finalScore.textContent = this.score;
    ui.finalBest.textContent = this.best;
    ui.finalDiff.textContent = this.diff.name;
    // 本局最大数字：一次都没合成过时，取场上最大的球
    let maxValue = this.maxReached;
    for (const ball of this.balls) maxValue = Math.max(maxValue, ball.getData('value'));
    ui.finalMax.textContent = maxValue || '-';
    // 本局分数 = 最高分且大于 0，说明打破了纪录
    ui.newRecord.classList.toggle('hidden', !isNewRecord);
    ui.btnRevive.classList.toggle('hidden', this.revived); // 复活过就不再显示复活按钮
    ui.modal.classList.remove('hidden');
  }

  /**
   * 复活：消除最上面的 3 个球，从当前局面继续
   * （由"看广告复活"按钮在用户看完激励广告后调用）
   */
  revive() {
    this.revived = true;

    // 按"球顶部的高度"从上到下排序，消除最上面的几个
    const sorted = [...this.balls].sort(
      (a, b) => (a.y - a.getData('radius')) - (b.y - b.getData('radius'))
    );
    sorted.slice(0, CONFIG.REVIVE_REMOVE_COUNT).forEach((ball) => this.removeBall(ball));

    // 剩下的球重新计时，并给 1 秒免检期，避免一复活马上又输
    for (const ball of this.balls) {
      ball.setData({ overTime: 0, age: 0 });
    }

    this.isOver = false;
    this.lastDropTime = -Infinity;
    this.roundId++; // 作废结束前还没执行的"显示预览球"延时任务，避免复活后又重复显示一次
    this.dangerLineRed.setVisible(false);
    this.matter.world.resume();
    this.showPreview(this.preview.x);
    Sound.play('revive');

    trackEvent(EVENTS.REVIVE_USED, { game: 'merge', difficulty: this.diffKey, score: this.score });
  }

  /* ---------------- 绘图辅助 ---------------- */

  /** 画一条横向虚线 */
  drawDashedLine(g, y, color, alpha) {
    const dash = 12 * S;
    const gap = 8 * S;
    g.lineStyle(2 * DPR, color, alpha);
    for (let x = 0; x < GAME_W; x += dash + gap) {
      g.lineBetween(x, y, Math.min(x + dash, GAME_W), y);
    }
  }
}

/* =========================================================
 * 8. 难度选择弹窗
 * ========================================================= */

/** 显示难度选择弹窗：每个难度一个按钮，显示说明和该难度的最高分 */
function showDifficultyPicker() {
  const last = loadLastDifficulty();
  ui.diffList.innerHTML = '';

  for (const key of Object.keys(DIFFICULTIES)) {
    const d = DIFFICULTIES[key];
    const btn = document.createElement('button');
    btn.className = 'diff-btn' + (key === last ? ' last' : '');
    btn.innerHTML =
      '<span class="name">' + d.name + '</span>' +
      '<span class="desc">' + d.desc + '</span>' +
      '<span class="best">Best ' + loadBest(key) + '</span>';
    btn.addEventListener('click', () => {
      ui.diffModal.classList.add('hidden');
      game.scene.getScene('MergeScene').startGame(key);
    });
    ui.diffList.appendChild(btn);
  }

  ui.diffModal.classList.remove('hidden');
}

/* =========================================================
 * 9. 启动游戏
 * ========================================================= */
const game = new Phaser.Game({
  type: Phaser.AUTO,           // 优先 WebGL，不支持时自动退回 Canvas
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#fdf6ec',
  scale: {
    mode: Phaser.Scale.FIT,    // 等比缩放适配容器
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { y: CONFIG.GRAVITY * S }, // 重力随尺寸缩放，保证不同屏幕下落速度观感一致
      positionIterations: 10,  // 迭代次数调高一点，球堆叠更稳定、不易穿透
      velocityIterations: 8,
      debug: false             // 改成 true 可以看到物理碰撞框，调试用
    }
  },
  scene: MergeScene
});

/* =========================================================
 * 10. 结束弹窗的按钮
 *
 * 广告点位：
 *   - "看广告复活" → 激励广告（showRewarded），看完才复活
 *   - "再来一局" / "切换难度" → 关闭弹窗后调用插屏广告（showInterstitial），
 *     ads.js 里有频率控制：每 2 次才真正展示 1 次，被跳过时会直接执行回调
 * ========================================================= */

/* "看广告复活"：看完激励广告 → 消除最上面 3 个球继续玩；中途放弃则停留在结束弹窗 */
ui.btnRevive.addEventListener('click', () => {
  showRewarded(() => {
    ui.modal.classList.add('hidden');
    game.scene.getScene('MergeScene').revive();
  });
});

/* "再来一局"：（可能）插屏广告 → 同一难度重开 */
ui.btnRestart.addEventListener('click', () => {
  ui.modal.classList.add('hidden');
  showInterstitial(() => {
    const scene = game.scene.getScene('MergeScene');
    scene.startGame(scene.diffKey);
  });
});

/* "切换难度"：（可能）插屏广告 → 回到难度选择 */
ui.btnChangeDiff.addEventListener('click', () => {
  ui.modal.classList.add('hidden');
  showInterstitial(() => showDifficultyPicker());
});

/* =========================================================
 * 11. 静音开关
 * ========================================================= */
function updateMuteUI() {
  ui.btnMute.textContent = Sound.isMuted() ? '🔇' : '🔊';
}
updateMuteUI();
ui.btnMute.addEventListener('click', () => {
  Sound.toggle();
  updateMuteUI();
});

/* =========================================================
 * 12. 横屏处理
 *   - 手机横屏时 CSS 会显示"请竖屏游玩"，这里同时暂停游戏，避免限时掉落在看不见时自动落球
 *   - 画布尺寸在页面加载时就定死了：如果是横屏打开的，转回竖屏后画布比例不对，直接刷新页面
 * ========================================================= */
const LANDSCAPE_QUERY = window.matchMedia('(orientation: landscape) and (max-height: 500px)'); // ⚠ 与 index.html 中 #rotate-tip 的媒体查询一致
const loadedInLandscape = LANDSCAPE_QUERY.matches;

function onOrientationChange() {
  if (LANDSCAPE_QUERY.matches) {
    game.scene.pause('MergeScene');
  } else if (loadedInLandscape) {
    location.reload();
  } else if (!userPaused) {
    game.scene.resume('MergeScene');
  }
}

/* =========================================================
 * 13. 切后台 / 窗口失去焦点：暂停，等玩家点"继续游戏"
 *   普通及以上难度有限时落球，不暂停的话人不在时球也会自动掉下去
 * ========================================================= */
let userPaused = false;

function pauseGame() {
  const scene = game.scene.getScene('MergeScene');
  if (userPaused || !scene || scene.isOver) return; // 只在对局进行中暂停
  userPaused = true;
  game.scene.pause('MergeScene');
  ui.pauseModal.classList.remove('hidden');
}

function resumeGame() {
  if (!userPaused) return;
  userPaused = false;
  ui.pauseModal.classList.add('hidden');
  if (!LANDSCAPE_QUERY.matches) game.scene.resume('MergeScene');
}

window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});
ui.btnResume.addEventListener('click', resumeGame);
// 老版本 Safari 不支持 addEventListener，只支持 addListener
if (LANDSCAPE_QUERY.addEventListener) LANDSCAPE_QUERY.addEventListener('change', onOrientationChange);
else LANDSCAPE_QUERY.addListener(onOrientationChange);
// 注：横屏打开页面时不用额外暂停——提示层盖住了难度选择，游戏根本开始不了
