/* =========================================================
 * erdayi/game.js — "二打一"页面逻辑
 * 用途：画棋盘、处理点击走棋、轮流让电脑走、判定胜负、悔棋、弹窗
 *   - 规则判定和电脑 AI 在 ai.js 里（window.ErDaYi），这里只管"页面和流程"
 *   - 棋盘用 SVG 画，坐标单位：相邻两个交叉点相距 CELL
 *   - 难度 = 棋盘大小（4×4 / 5×5 / 6×6）× 电脑强度（简单 / 普通 / 困难）
 *
 * 依赖（在 index.html 中按顺序引入）：
 *   shared/analytics.js → shared/ads.js → shared/sound.js → ai.js → 本文件
 * ========================================================= */

const { PLAYER, AI } = ErDaYi;

// 公共文件（../shared/ 下的样式和脚本）没加载到时，页面顶部给出醒目提示。
// 最常见的原因：本地服务器是在 erdayi 文件夹里启动的，应该在网站根目录（D:\GAMES）启动
if (!getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()) {
  const tip = document.createElement('div');
  tip.textContent = 'Shared files (shared/) failed to load, so the page will look broken. Run python -m http.server 8000 in the site root (e.g. D:\\GAMES) and open http://localhost:8000/erdayi/';
  tip.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 14px;background:#e74c3c;color:#fff;font-size:14px;line-height:1.5;';
  document.body.appendChild(tip);
}

// 音效脚本（shared/sound.js）没加载成功时，用一个什么都不做的替身顶上：
// 游戏照常运行，只是没有声音，不会因为音效报错卡住
if (!window.Sound) {
  console.warn('[erdayi] shared/sound.js failed to load, no sound this game');
  window.Sound = {
    play() {},
    toggle() { return true; },
    isMuted() { return true; },
    suspend() {},
    resume() {}
  };
}

/* =========================================================
 * 1. 通用参数
 * ========================================================= */
const CONFIG = {
  CELL: 100,            // 相邻交叉点的距离（SVG 单位）
  MARGIN: 50,           // 棋盘四周留白
  PIECE_R: 34,          // 棋子半径
  MOVE_ANIM: 250,       // 走棋动画时长（毫秒），⚠ 与 index.html 中 .piece 的 transition 一致
  AI_DELAY: 600,        // 电脑"思考"前的停顿（毫秒），让玩家看清自己刚走的棋
  END_DELAY: 700,       // 分出胜负后，多久弹出结束弹窗（毫秒）
  DRAW_LIMIT: 60,       // 连续这么多步（双方合计）没人吃子 → 和棋
  DRAW_WARN: 40,        // 无吃子步数达到这个值时开始提示
  UNDO_PER_GAME: 3,     // 每局最多悔棋次数（每次都要看激励广告）

  SETTINGS_KEY: 'erdayi_settings',   // 上次选择的棋盘和难度
  STATS_KEY: 'erdayi_stats_',        // 战绩键名前缀（后面接 棋盘_难度）
  RULES_SEEN_KEY: 'erdayi_rules_seen', // 是否看过规则（第一次进入自动弹出）
  HINT_KEY: 'erdayi_hint_seen'         // 是否看过第一局的操作提示
};

// 棋子颜色 ⚠ 与 index.html 中 --player / --ai 一致
const COLORS = {
  [PLAYER]: '#ff7f50',
  [AI]: '#3d4b63'
};

/* =========================================================
 * 2. 难度配置（想调电脑强度，改这里即可）
 * ========================================================= */

// 棋盘大小：N 条线 × N 条线，每方 N 枚棋子
const BOARD_SIZES = {
  4: { name: '4×4', desc: 'Classic' },
  5: { name: '5×5', desc: '16 squares' },
  6: { name: '6×6', desc: '25 squares' }
};

// 电脑强度（字段含义见 ai.js 的 chooseMove）
const LEVELS = {
  easy:   { name: 'Easy', desc: 'Makes mistakes', randomRate: 0.35, depth: 2,  timeLimit: 500 },
  normal: { name: 'Normal', desc: 'Thinks 3 moves ahead', randomRate: 0,    depth: 3,  timeLimit: 1000 },
  hard:   { name: 'Hard', desc: 'Plays its best', randomRate: 0,    depth: 12, timeLimit: 900 }
};

const DEFAULT_SETTINGS = { size: 4, level: 'normal' };

/* =========================================================
 * 3. 本地存储
 * ========================================================= */
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
    /* 隐私模式下可能不可用，忽略 */
  }
}

function loadSettings() {
  try {
    const s = JSON.parse(storageGet(CONFIG.SETTINGS_KEY));
    if (s && BOARD_SIZES[s.size] && LEVELS[s.level]) return s;
  } catch (e) {
    /* 数据损坏就用默认值 */
  }
  return { ...DEFAULT_SETTINGS };
}

function statsKey(size, level) {
  return CONFIG.STATS_KEY + size + '_' + level;
}
function loadStats(size, level) {
  try {
    const s = JSON.parse(storageGet(statsKey(size, level)));
    if (s) return { win: s.win || 0, lose: s.lose || 0, draw: s.draw || 0 };
  } catch (e) {
    /* 忽略 */
  }
  return { win: 0, lose: 0, draw: 0 };
}
function statsText(st) {
  return 'Record: ' + st.win + 'W ' + st.lose + 'L' + (st.draw ? ' ' + st.draw + 'D' : '');
}

/* =========================================================
 * 4. 页面元素
 * ========================================================= */
const $ = (id) => document.getElementById(id);
const ui = {
  hint: $('hint'),
  boardWrap: $('board-wrap'),
  svg: $('board'),
  gameSub: $('game-sub'),
  btnMute: $('btn-mute'),
  chipPlayer: $('chip-player'),
  chipAi: $('chip-ai'),
  countPlayer: $('count-player'),
  countAi: $('count-ai'),
  turnText: $('turn-text'),
  btnUndo: $('btn-undo'),
  undoLeft: $('undo-left'),
  btnOpenSetup: $('btn-open-setup'),
  btnOpenRules: $('btn-open-rules'),
  setupModal: $('setup-modal'),
  sizeSeg: $('size-seg'),
  levelSeg: $('level-seg'),
  record: $('record'),
  btnStart: $('btn-start'),
  btnCancelSetup: $('btn-cancel-setup'),
  btnSetupRules: $('btn-setup-rules'),
  rulesModal: $('rules-modal'),
  btnCloseRules: $('btn-close-rules'),
  endModal: $('end-modal'),
  endTitle: $('end-title'),
  endSub: $('end-sub'),
  endRecord: $('end-record'),
  btnEndUndo: $('btn-end-undo'),
  btnAgain: $('btn-again'),
  btnEndSetup: $('btn-end-setup')
};

/* =========================================================
 * 5. 对局状态
 * ========================================================= */
const state = {
  size: 4,            // 棋盘线数 N
  level: 'normal',
  nb: null,           // 邻居表（ai.js 的 buildNeighbors）
  board: null,        // Int8Array，见 ai.js 顶部说明
  turn: PLAYER,
  started: false,     // 是否已经开过局（用于设置弹窗显示"继续当前对局"）
  over: true,
  result: null,       // 'win' | 'lose' | 'draw'
  selected: -1,       // 玩家选中的棋子位置，-1 表示没选
  lastMove: null,     // 上一步 { from, to, side }，用于标记
  noCapture: 0,       // 连续无吃子步数
  moveCount: 0,       // 本局总步数（双方合计）
  history: [],        // 玩家每次走棋前的局面快照，用于悔棋
  hintOn: false,      // 第一局的操作提示是否显示中
  undoLeft: 0,
  token: 0            // 局面版本号：开新局 / 悔棋时 +1，用来作废还没执行的电脑走棋
};

/* =========================================================
 * 6. 棋盘绘制（SVG）
 * ========================================================= */
const SVGNS = 'http://www.w3.org/2000/svg';
const layers = {};     // 分层：标记 / 棋子 / 提示 / 特效 / 点击区
let pieceEls = {};     // 位置 → 棋子的 <g> 元素

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

/** 交叉点的 SVG 坐标 */
function pointXY(pos) {
  const N = state.size;
  return {
    x: CONFIG.MARGIN + (pos % N) * CONFIG.CELL,
    y: CONFIG.MARGIN + Math.floor(pos / N) * CONFIG.CELL
  };
}

/** 新开一局时重画整个棋盘（线、分层、点击区） */
function buildBoard() {
  const N = state.size;
  const { CELL, MARGIN } = CONFIG;
  const size = (N - 1) * CELL + MARGIN * 2;
  const svg = ui.svg;
  svg.innerHTML = '';
  svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);

  // 木色底板
  svgEl('rect', { x: 4, y: 4, width: size - 8, height: size - 8, rx: 24, fill: '#f1dcb4' }, svg);

  // 棋盘线：外框粗一点
  const lines = svgEl('g', { stroke: '#b98d4f', 'stroke-width': 4, 'stroke-linecap': 'round' }, svg);
  const lo = MARGIN;
  const hi = MARGIN + (N - 1) * CELL;
  for (let i = 0; i < N; i++) {
    const v = MARGIN + i * CELL;
    svgEl('line', { x1: lo, y1: v, x2: hi, y2: v }, lines);
    svgEl('line', { x1: v, y1: lo, x2: v, y2: hi }, lines);
  }
  svgEl('rect', { x: lo, y: lo, width: hi - lo, height: hi - lo, fill: 'none', stroke: '#9c7038', 'stroke-width': 6, rx: 2 }, svg);

  layers.marks = svgEl('g', {}, svg);
  layers.pieces = svgEl('g', {}, svg);
  layers.hints = svgEl('g', { 'pointer-events': 'none' }, svg);
  layers.fx = svgEl('g', { 'pointer-events': 'none' }, svg);

  // 点击区：每个交叉点一个透明大圆，比棋子大，手指好点
  layers.hit = svgEl('g', {}, svg);
  for (let p = 0; p < N * N; p++) {
    const { x, y } = pointXY(p);
    svgEl('circle', { class: 'hit', cx: x, cy: y, r: CELL * 0.48, 'data-pos': p }, layers.hit);
  }

  fitBoard();
}

/** 让棋盘在可用区域里尽量大、保持正方形 */
function fitBoard() {
  const w = ui.boardWrap.clientWidth - 24;  // 减去左右 padding
  const h = ui.boardWrap.clientHeight - 16; // 减去上下 padding
  const s = Math.max(100, Math.floor(Math.min(w, h)));
  ui.svg.setAttribute('width', s);
  ui.svg.setAttribute('height', s);
}

/** 把棋子 <g> 放到某个交叉点（CSS transition 负责动画） */
function placePiece(g, pos) {
  const { x, y } = pointXY(pos);
  g.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
}

function createPiece(pos, side) {
  const g = svgEl('g', { class: 'piece' }, layers.pieces);
  const R = CONFIG.PIECE_R;
  svgEl('circle', { r: R, cy: 3, fill: 'rgba(0,0,0,0.18)' }, g);            // 影子
  svgEl('circle', { r: R, fill: COLORS[side] }, g);                          // 棋子
  svgEl('circle', { r: R * 0.38, cx: -R * 0.3, cy: -R * 0.32, fill: 'rgba(255,255,255,0.22)' }, g); // 高光
  placePiece(g, pos);
  pieceEls[pos] = g;
  return g;
}

/** 按 state.board 重建所有棋子（开局、悔棋时用） */
function renderPieces() {
  layers.pieces.innerHTML = '';
  layers.fx.innerHTML = '';
  pieceEls = {};
  for (let p = 0; p < state.board.length; p++) {
    if (state.board[p]) createPiece(p, state.board[p]);
  }
}

/** 画标记：上一步的起点、选中的棋子、可走的位置 */
function renderMarks() {
  layers.marks.innerHTML = '';
  layers.hints.innerHTML = '';
  const R = CONFIG.PIECE_R;

  // 上一步（用走棋方的颜色）：起点画一个空心圈，终点棋子外画一圈描边。
  // 电脑刚走的那一步描边会闪动，让玩家一眼看出电脑动了哪颗子
  if (state.lastMove) {
    const color = COLORS[state.lastMove.side];
    const a = pointXY(state.lastMove.from);
    svgEl('circle', { cx: a.x, cy: a.y, r: 12, fill: 'none', stroke: color, 'stroke-width': 4, opacity: 0.6 }, layers.marks);
    const b = pointXY(state.lastMove.to);
    svgEl('circle', {
      class: state.lastMove.side === AI ? 'hint-dot' : '',
      cx: b.x, cy: b.y, r: R + 8, fill: 'none', stroke: color, 'stroke-width': 5, opacity: 0.6
    }, layers.marks);
  }

  // 第一局的操作提示：还没选子时，给所有能走的橙子套一个闪动的圈
  if (state.hintOn && !state.over && state.turn === PLAYER) {
    ui.hint.classList.remove('hidden');
    ui.hint.textContent = state.selected < 0
      ? '👆 First tap one of your orange pieces'
      : '👆 Now tap a glowing dot to move there';
    if (state.selected < 0) {
      for (let p = 0; p < state.board.length; p++) {
        if (state.board[p] !== PLAYER || !state.nb[p].some((q) => !state.board[q])) continue;
        const c = pointXY(p);
        svgEl('circle', { class: 'hint-dot', cx: c.x, cy: c.y, r: R + 10, fill: 'none', stroke: '#f2b705', 'stroke-width': 6 }, layers.hints);
      }
    }
  } else {
    ui.hint.classList.add('hidden');
  }

  // 选中的棋子 + 可走的空位
  if (state.selected >= 0) {
    const s = pointXY(state.selected);
    svgEl('circle', { cx: s.x, cy: s.y, r: R + 8, fill: 'none', stroke: COLORS[PLAYER], 'stroke-width': 5 }, layers.marks);
    for (const q of state.nb[state.selected]) {
      if (state.board[q]) continue;
      const t = pointXY(q);
      svgEl('circle', { class: 'hint-dot', cx: t.x, cy: t.y, r: 14, fill: COLORS[PLAYER] }, layers.hints);
    }
  }
}

/** 吃子特效：沿三子串画一条红线（CSS 动画自动淡出），被吃的棋子画个红叉 */
function playCaptureFx(runs, caps) {
  for (const run of runs) {
    const a = pointXY(run[0]);
    const b = pointXY(run[run.length - 1]);
    const line = svgEl('line', {
      class: 'capture-line', x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: '#e74c3c', 'stroke-width': 10, 'stroke-linecap': 'round', opacity: 0.75
    }, layers.fx);
    setTimeout(() => line.remove(), 1000);
  }
  for (const c of caps) {
    const { x, y } = pointXY(c);
    const d = CONFIG.PIECE_R * 0.6;
    const g = svgEl('g', { class: 'capture-line', stroke: '#fff', 'stroke-width': 8, 'stroke-linecap': 'round' }, layers.fx);
    svgEl('line', { x1: x - d, y1: y - d, x2: x + d, y2: y + d }, g);
    svgEl('line', { x1: x + d, y1: y - d, x2: x - d, y2: y + d }, g);
    setTimeout(() => g.remove(), 1000);
  }
}

/* =========================================================
 * 7. 状态栏 / 按钮
 * ========================================================= */
function updateStatus() {
  ui.countPlayer.textContent = '×' + ErDaYi.countSide(state.board, PLAYER);
  ui.countAi.textContent = '×' + ErDaYi.countSide(state.board, AI);

  const myTurn = !state.over && state.turn === PLAYER;
  ui.chipPlayer.classList.toggle('active', myTurn);
  ui.chipAi.classList.toggle('active', !state.over && state.turn === AI);

  let text;
  if (!state.started) text = 'Choose a level';
  else if (state.over) text = { win: 'You won', lose: 'You lost', draw: 'Draw' }[state.result];
  else if (!myTurn) text = 'AI is thinking…';
  else text = state.lastMove && state.lastMove.side === AI ? 'AI moved — your turn' : 'Your turn';
  ui.turnText.firstChild.textContent = text;

  // 快到和棋步数时提醒
  const warn = $('draw-warn');
  warn.textContent = !state.over && state.noCapture >= CONFIG.DRAW_WARN
    ? 'Draw in ' + (CONFIG.DRAW_LIMIT - state.noCapture) + ' moves without a capture'
    : '';

  ui.undoLeft.textContent = state.undoLeft + ' left';
  ui.btnUndo.disabled = !canUndo();
}

/* =========================================================
 * 8. 对局流程
 * ========================================================= */

/** 开新局 */
function startGame(size, level) {
  state.size = size;
  state.level = level;
  state.nb = ErDaYi.buildNeighbors(size);
  state.board = ErDaYi.createBoard(size);
  state.turn = PLAYER;
  state.started = true;
  state.over = false;
  state.result = null;
  state.selected = -1;
  state.lastMove = null;
  state.noCapture = 0;
  state.moveCount = 0;
  state.history = [];
  state.undoLeft = CONFIG.UNDO_PER_GAME;
  state.token++;
  state.hintOn = !storageGet(CONFIG.HINT_KEY); // 第一局显示操作提示
  storageSet(CONFIG.SETTINGS_KEY, JSON.stringify({ size: size, level: level }));

  ui.gameSub.textContent = BOARD_SIZES[size].name + ' · ' + LEVELS[level].name;
  buildBoard();
  renderPieces();
  renderMarks();
  updateStatus();

  trackEvent(EVENTS.GAME_START, { game: 'erdayi', size: size, level: level });
}

/**
 * 走一步（玩家和电脑共用）：改棋盘 + 播动画 + 音效
 * @returns {number[]} 被吃掉的位置
 */
function makeMove(from, to, side) {
  const runs = [];
  const caps = ErDaYi.applyMove(state.board, from, to, side, state.size, runs);

  // 移动棋子元素
  const g = pieceEls[from];
  delete pieceEls[from];
  pieceEls[to] = g;
  placePiece(g, to);

  // 被吃的棋子：等走棋动画结束再淡出
  for (const c of caps) {
    const dead = pieceEls[c];
    delete pieceEls[c];
    setTimeout(() => {
      dead.classList.add('dead');
      setTimeout(() => dead.remove(), 300);
    }, CONFIG.MOVE_ANIM);
  }

  state.lastMove = { from: from, to: to, side: side };
  state.moveCount++;
  state.noCapture = caps.length ? 0 : state.noCapture + 1;

  if (caps.length) {
    setTimeout(() => {
      playCaptureFx(runs, caps);
      Sound.play('capture');
    }, CONFIG.MOVE_ANIM);
  } else {
    Sound.play('move');
  }
  return caps;
}

/**
 * 一方走完后检查胜负
 * @returns {boolean} 是否已结束
 */
function checkEnd(mover) {
  const opp = 3 - mover;
  let result = null;
  if (ErDaYi.countSide(state.board, opp) <= 1 || !ErDaYi.hasMove(state.board, opp, state.nb)) {
    result = mover === PLAYER ? 'win' : 'lose';
  } else if (state.noCapture >= CONFIG.DRAW_LIMIT) {
    result = 'draw';
  }
  if (result) endGame(result);
  return !!result;
}

/** 点击了棋盘上的某个交叉点 */
function onPointTap(pos) {
  if (state.over || state.turn !== PLAYER) return;

  if (state.board[pos] === PLAYER) {
    // 点自己的棋子：选中（再点一次取消）
    state.selected = state.selected === pos ? -1 : pos;
  } else if (state.selected >= 0 && state.board[pos] === 0 && state.nb[state.selected].includes(pos)) {
    playerMove(state.selected, pos);
    return;
  } else {
    state.selected = -1;
  }
  renderMarks();
}

function playerMove(from, to) {
  // 走出第一步：操作提示完成使命
  if (state.hintOn) {
    state.hintOn = false;
    storageSet(CONFIG.HINT_KEY, '1');
  }

  // 走之前存快照，悔棋时回到这里
  state.history.push({
    board: state.board.slice(),
    lastMove: state.lastMove,
    noCapture: state.noCapture,
    moveCount: state.moveCount
  });

  state.selected = -1;
  state.turn = AI; // 先交出走棋权：即使后面画面出错，玩家也不能连走两步
  makeMove(from, to, PLAYER);
  renderMarks();

  if (!checkEnd(PLAYER)) scheduleAiMove();
  updateStatus();
}

/** 电脑走棋：先停顿一下（让状态栏显示"思考中"、玩家看清自己的棋），再计算 */
function scheduleAiMove() {
  const token = state.token;
  setTimeout(() => {
    if (token !== state.token || state.over) return; // 期间开了新局 / 悔了棋
    let move = null;
    try {
      move = ErDaYi.chooseMove(state.board, state.size, state.nb, LEVELS[state.level]);
    } catch (e) {
      // AI 出错时退回随机走一步，保证对局不会卡住
      console.error('[erdayi] AI error, falling back to a random move', e);
      const moves = ErDaYi.genMoves(state.board, AI, state.nb);
      move = moves[Math.floor(Math.random() * moves.length)];
    }
    if (!move) return; // 理论上不会发生：没棋可走在 checkEnd 里就判负了
    makeMove(move[0], move[1], AI);
    renderMarks();
    if (!checkEnd(AI)) state.turn = PLAYER;
    updateStatus();
  }, CONFIG.AI_DELAY);
}

function endGame(result) {
  state.over = true;
  state.result = result;
  state.token++;

  const st = loadStats(state.size, state.level);
  st[result]++;
  storageSet(statsKey(state.size, state.level), JSON.stringify(st));

  trackEvent(EVENTS.GAME_END, {
    game: 'erdayi', size: state.size, level: state.level, result: result, moves: state.moveCount
  });

  setTimeout(() => {
    Sound.play(result === 'win' ? 'win' : 'gameover');
    showEndModal();
  }, CONFIG.END_DELAY);
}

/* ---------------- 悔棋 ---------------- */

/** 现在能不能悔棋：轮到玩家（或玩家刚输），且有历史、有次数 */
function canUndo() {
  if (state.undoLeft <= 0 || state.history.length === 0) return false;
  if (state.over) return state.result === 'lose';
  return state.turn === PLAYER;
}

/** 回到玩家上一次走棋之前（连同电脑的应对一起撤销） */
function doUndo() {
  const snap = state.history.pop();
  state.board = snap.board;
  state.lastMove = snap.lastMove;
  state.noCapture = snap.noCapture;
  state.moveCount = snap.moveCount;
  state.undoLeft--;
  state.turn = PLAYER;
  state.selected = -1;
  state.token++; // 作废可能还在等待的电脑走棋

  // 输了之后悔棋：撤销刚记下的那一负
  if (state.over && state.result === 'lose') {
    const st = loadStats(state.size, state.level);
    st.lose = Math.max(0, st.lose - 1);
    storageSet(statsKey(state.size, state.level), JSON.stringify(st));
  }
  state.over = false;
  state.result = null;

  renderPieces();
  renderMarks();
  updateStatus();
  Sound.play('revive');
  trackEvent(EVENTS.UNDO_USED, { game: 'erdayi', size: state.size, level: state.level });
}

/** 悔棋要先看完激励广告 */
function requestUndo(onDone) {
  if (!canUndo()) return;
  showRewarded(() => {
    if (!canUndo()) return; // 看广告期间状态变了
    doUndo();
    if (onDone) onDone();
  });
}

/* =========================================================
 * 9. 弹窗
 * ========================================================= */

/** 设置弹窗：选棋盘大小 + 电脑难度 */
const pending = loadSettings(); // 弹窗里当前选中的设置（点"开始对局"才生效）

function renderSetup() {
  ui.sizeSeg.innerHTML = '';
  for (const key of Object.keys(BOARD_SIZES)) {
    const size = Number(key);
    const b = BOARD_SIZES[key];
    const btn = document.createElement('button');
    btn.className = size === pending.size ? 'on' : '';
    btn.innerHTML = '<span class="name">' + b.name + '</span><span class="desc">' + b.desc + '</span>';
    btn.addEventListener('click', () => {
      pending.size = size;
      renderSetup();
    });
    ui.sizeSeg.appendChild(btn);
  }

  ui.levelSeg.innerHTML = '';
  for (const key of Object.keys(LEVELS)) {
    const lv = LEVELS[key];
    const btn = document.createElement('button');
    btn.className = key === pending.level ? 'on' : '';
    btn.innerHTML = '<span class="name">' + lv.name + '</span><span class="desc">' + lv.desc + '</span>';
    btn.addEventListener('click', () => {
      pending.level = key;
      renderSetup();
    });
    ui.levelSeg.appendChild(btn);
  }

  ui.record.textContent = statsText(loadStats(pending.size, pending.level));
}

function showSetup() {
  renderSetup();
  // 对局进行中打开设置，可以选择不换、继续下
  ui.btnCancelSetup.classList.toggle('hidden', !(state.started && !state.over));
  ui.setupModal.classList.remove('hidden');
}

function showRules() {
  ui.rulesModal.classList.remove('hidden');
}

function showEndModal() {
  ui.endTitle.textContent = { win: '🎉 You won!', lose: 'You lost', draw: 'Draw' }[state.result];
  // 重新触发标题动画：赢了弹跳，输了摇头
  ui.endTitle.className = '';
  void ui.endTitle.offsetWidth;
  ui.endTitle.className = state.result === 'draw' ? '' : state.result;
  const left = ErDaYi.countSide(state.board, PLAYER);
  ui.endSub.textContent = BOARD_SIZES[state.size].name + ' · ' + LEVELS[state.level].name +
    ' · ' + state.moveCount + ' moves · ' + left + ' pieces left';
  ui.endRecord.textContent = statsText(loadStats(state.size, state.level));
  ui.btnEndUndo.classList.toggle('hidden', !canUndo());
  ui.endModal.classList.remove('hidden');
}

/* =========================================================
 * 10. 事件绑定
 * ========================================================= */

// 脚本出错时把错误显示在状态栏，方便排查（上线稳定后可以删掉）
window.addEventListener('error', (e) => {
  ui.turnText.firstChild.textContent = 'Something went wrong: ' + e.message;
});

// 棋盘点击（事件委托到点击区）
ui.svg.addEventListener('click', (e) => {
  const hit = e.target.closest('[data-pos]');
  if (hit) onPointTap(Number(hit.getAttribute('data-pos')));
});

ui.btnUndo.addEventListener('click', () => requestUndo());
ui.btnOpenSetup.addEventListener('click', showSetup);
ui.btnOpenRules.addEventListener('click', showRules);

ui.btnStart.addEventListener('click', () => {
  ui.setupModal.classList.add('hidden');
  startGame(pending.size, pending.level);
});
ui.btnCancelSetup.addEventListener('click', () => ui.setupModal.classList.add('hidden'));
ui.btnSetupRules.addEventListener('click', showRules);
ui.btnCloseRules.addEventListener('click', () => {
  ui.rulesModal.classList.add('hidden');
  storageSet(CONFIG.RULES_SEEN_KEY, '1');
});

// 结束弹窗：看广告悔一步 → 回到对局
ui.btnEndUndo.addEventListener('click', () => {
  requestUndo(() => ui.endModal.classList.add('hidden'));
});

// 再来一局：（可能）插屏广告 → 同样设置重开。ads.js 有频控，每 2 次才真正展示 1 次
ui.btnAgain.addEventListener('click', () => {
  ui.endModal.classList.add('hidden');
  showInterstitial(() => startGame(state.size, state.level));
});

// 切换难度：（可能）插屏广告 → 设置弹窗
ui.btnEndSetup.addEventListener('click', () => {
  ui.endModal.classList.add('hidden');
  showInterstitial(showSetup);
});

// 静音开关
function updateMuteUI() {
  ui.btnMute.textContent = Sound.isMuted() ? '🔇' : '🔊';
}
ui.btnMute.addEventListener('click', () => {
  Sound.toggle();
  updateMuteUI();
});

// 窗口大小变化（地址栏收起、转屏）时重新适配棋盘
window.addEventListener('resize', fitBoard);

/* =========================================================
 * 11. 启动：先画一个空棋盘垫底，弹出设置；第一次来自动弹出规则
 * ========================================================= */
updateMuteUI();
state.nb = ErDaYi.buildNeighbors(pending.size);
state.size = pending.size;
state.board = ErDaYi.createBoard(pending.size);
buildBoard();
renderPieces();
updateStatus();
showSetup();
if (!storageGet(CONFIG.RULES_SEEN_KEY)) showRules();
