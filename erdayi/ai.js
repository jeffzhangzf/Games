/* =========================================================
 * erdayi/ai.js — "二打一"的规则判定 + 电脑 AI
 * 用途：纯逻辑，不操作页面。game.js 用它判断走法、吃子、胜负，并让电脑选步。
 *
 * 棋盘表示：
 *   N×N 个交叉点，用一维数组 board 存储，下标 pos = 行 * N + 列
 *   值：0 空 / 1 玩家（PLAYER）/ 2 电脑（AI）
 *
 * 吃子规则（走棋的一方才能吃）：
 *   走完一步后，分别看被移动棋子所在的整条横线和整条竖线：
 *   如果这条线上一共只有 3 个子，三子紧挨着，并且是  己 己 敌  或  敌 己 己，
 *   就吃掉那个敌子。线上只要还有第 4 个子（不管隔多远、是谁的），就不能吃。
 *
 * 电脑：negamax + alpha-beta 剪枝 + 迭代加深，带时间上限
 *
 * 对外：window.ErDaYi = { PLAYER, AI, createBoard, buildNeighbors, genMoves,
 *                         applyMove, undoMove, countSide, chooseMove }
 * ========================================================= */

(function () {
  'use strict';

  var PLAYER = 1;
  var AI = 2;
  var WIN = 100000;          // 胜负的分值，远大于任何局面评分
  var AXES = [[0, 1], [1, 0]]; // 横、竖两个方向
  var TIMEOUT = {};          // 搜索超时时抛出的标记对象

  /* ---------------- 棋盘 ---------------- */

  /** 新棋盘：电脑占第一行，玩家占最后一行 */
  function createBoard(N) {
    var board = new Int8Array(N * N);
    for (var c = 0; c < N; c++) {
      board[c] = AI;
      board[(N - 1) * N + c] = PLAYER;
    }
    return board;
  }

  /** 预先算好每个点的上下左右邻居，走棋和搜索时直接查表 */
  function buildNeighbors(N) {
    var nb = [];
    for (var p = 0; p < N * N; p++) {
      var r = (p / N) | 0;
      var c = p % N;
      var list = [];
      if (r > 0) list.push(p - N);
      if (r < N - 1) list.push(p + N);
      if (c > 0) list.push(p - 1);
      if (c < N - 1) list.push(p + 1);
      nb.push(list);
    }
    return nb;
  }

  function countSide(board, side) {
    var n = 0;
    for (var i = 0; i < board.length; i++) if (board[i] === side) n++;
    return n;
  }

  /** 某一方所有合法走法：[[from, to], ...] */
  function genMoves(board, side, nb) {
    var moves = [];
    for (var p = 0; p < board.length; p++) {
      if (board[p] !== side) continue;
      var list = nb[p];
      for (var i = 0; i < list.length; i++) {
        if (board[list[i]] === 0) moves.push([p, list[i]]);
      }
    }
    return moves;
  }

  /** 某一方有没有棋可走（比 genMoves 快，找到一步就返回） */
  function hasMove(board, side, nb) {
    for (var p = 0; p < board.length; p++) {
      if (board[p] !== side) continue;
      var list = nb[p];
      for (var i = 0; i < list.length; i++) if (board[list[i]] === 0) return true;
    }
    return false;
  }

  /* ---------------- 吃子 ---------------- */

  /**
   * 检查 side 方刚走到 pos 后能吃掉哪些子
   * @param {Array} [runs] 可选：传入数组时，把形成吃子的三子串（下标数组）放进去，用于画特效
   * @returns {number[]} 被吃棋子的位置
   */
  function findCaptures(board, pos, side, N, runs) {
    var opp = 3 - side;
    var r0 = (pos / N) | 0;
    var c0 = pos % N;
    var caps = [];

    for (var a = 0; a < AXES.length; a++) {
      var dr = AXES[a][0];
      var dc = AXES[a][1];

      // 收集整条线上的所有棋子（按顺序），超过 3 个就不可能吃，提前停
      // 横线：从本行第 0 列开始；竖线：从本列第 0 行开始
      var r = dr ? 0 : r0;
      var c = dc ? 0 : c0;
      var run = [];
      var idx = [];   // 每个棋子在这条线上的序号，用来判断是否紧挨着
      for (var k = 0; k < N && run.length <= 3; k++) {
        var q = r * N + c;
        if (board[q] !== 0) {
          run.push(q);
          idx.push(k);
        }
        r += dr;
        c += dc;
      }
      if (run.length !== 3) continue;          // 线上必须恰好 3 个子
      if (idx[2] - idx[0] !== 2) continue;     // 而且三子必须紧挨着

      var v0 = board[run[0]], v1 = board[run[1]], v2 = board[run[2]];
      if (v0 === side && v1 === side && v2 === opp) {
        caps.push(run[2]);
        if (runs) runs.push(run);
      } else if (v0 === opp && v1 === side && v2 === side) {
        caps.push(run[0]);
        if (runs) runs.push(run);
      }
    }
    return caps;
  }

  /** 执行一步棋（直接修改 board），返回被吃掉的位置列表，供 undoMove 还原 */
  function applyMove(board, from, to, side, N, runs) {
    board[to] = side;
    board[from] = 0;
    var caps = findCaptures(board, to, side, N, runs);
    for (var i = 0; i < caps.length; i++) board[caps[i]] = 0;
    return caps;
  }

  /** 撤销 applyMove */
  function undoMove(board, from, to, side, caps) {
    board[from] = side;
    board[to] = 0;
    for (var i = 0; i < caps.length; i++) board[caps[i]] = 3 - side;
  }

  /* ---------------- 电脑 AI ---------------- */

  /**
   * 局面评分（站在 side 的角度，越大对 side 越有利）
   *   子数差 × 100  +  可走步数差 × 2  +  "轮到我走且有子可吃" 加 60
   */
  function evaluate(board, side, N, nb) {
    var opp = 3 - side;
    var my = 0, op = 0, myMob = 0, opMob = 0;
    for (var p = 0; p < board.length; p++) {
      var v = board[p];
      if (v === 0) continue;
      var free = 0;
      var list = nb[p];
      for (var i = 0; i < list.length; i++) if (board[list[i]] === 0) free++;
      if (v === side) { my++; myMob += free; } else { op++; opMob += free; }
    }
    var score = (my - op) * 100 + (myMob - opMob) * 2;

    // 轮到 side 走：如果有吃子的走法，相当于马上多赚一子的一大半
    var moves = genMoves(board, side, nb);
    for (var m = 0; m < moves.length; m++) {
      var caps = applyMove(board, moves[m][0], moves[m][1], side, N);
      undoMove(board, moves[m][0], moves[m][1], side, caps);
      if (caps.length) { score += 60; break; }
    }
    return score;
  }

  /** 把能吃子的走法排到前面（alpha-beta 先搜好棋，剪枝效率高很多） */
  function orderMoves(board, moves, side, N) {
    var good = [], rest = [];
    for (var i = 0; i < moves.length; i++) {
      var caps = applyMove(board, moves[i][0], moves[i][1], side, N);
      undoMove(board, moves[i][0], moves[i][1], side, caps);
      (caps.length ? good : rest).push(moves[i]);
    }
    return good.concat(rest);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 电脑选一步棋
   * @param {Int8Array} board 当前棋盘（不会被修改）
   * @param {object} level   难度配置：{ randomRate, depth, timeLimit }
   *   randomRate 有多大概率直接随便走一步（模拟"犯错"）
   *   depth      最多往后算几步（双方各走一次算 2 步）
   *   timeLimit  思考时间上限（毫秒），到时间就用已经算完的最深一层结果
   * @returns {number[]} [from, to]
   */
  function chooseMove(boardIn, N, nb, level) {
    var board = boardIn.slice();
    var side = AI;
    var rootMoves = genMoves(board, side, nb);
    if (rootMoves.length === 0) return null;
    if (Math.random() < level.randomRate) {
      return rootMoves[Math.floor(Math.random() * rootMoves.length)];
    }

    // 先打乱再排序：同分的走法每局不一样，电脑不会每次走得一模一样
    rootMoves = orderMoves(board, shuffle(rootMoves), side, N);

    var deadline = Date.now() + level.timeLimit;
    var nodes = 0;

    function negamax(s, depth, alpha, beta, ply) {
      if ((++nodes & 1023) === 0 && Date.now() > deadline) throw TIMEOUT;
      // 轮到 s 走时，s 只剩 1 子或无路可走 → s 输（越早输分越低，促使 AI 拖延失败、尽快取胜）
      if (countSide(board, s) <= 1) return -WIN + ply;
      var moves = genMoves(board, s, nb);
      if (moves.length === 0) return -WIN + ply;
      if (depth === 0) return evaluate(board, s, N, nb);

      if (depth >= 2) moves = orderMoves(board, moves, s, N);
      var best = -Infinity;
      for (var i = 0; i < moves.length; i++) {
        var f = moves[i][0], t = moves[i][1];
        var caps = applyMove(board, f, t, s, N);
        var v = -negamax(3 - s, depth - 1, -beta, -alpha, ply + 1);
        undoMove(board, f, t, s, caps);
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }

    var bestMove = rootMoves[0];
    for (var d = 1; d <= level.depth; d++) {
      try {
        var alpha = -Infinity;
        var iterBest = rootMoves[0];
        for (var i = 0; i < rootMoves.length; i++) {
          var f = rootMoves[i][0], t = rootMoves[i][1];
          var caps = applyMove(board, f, t, side, N);
          var v = -negamax(3 - side, d - 1, -Infinity, -alpha, 1);
          undoMove(board, f, t, side, caps);
          if (v > alpha) { alpha = v; iterBest = rootMoves[i]; }
        }
        bestMove = iterBest;
        // 本层最好的走法下一层先搜
        rootMoves.splice(rootMoves.indexOf(iterBest), 1);
        rootMoves.unshift(iterBest);
        if (alpha >= WIN - 100) break; // 已经找到必胜，不用再算
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        break; // 超时：用上一层算完的结果（被中断时 board 可能没还原，但后面不再用它）
      }
    }
    return bestMove;
  }

  window.ErDaYi = {
    PLAYER: PLAYER,
    AI: AI,
    createBoard: createBoard,
    buildNeighbors: buildNeighbors,
    genMoves: genMoves,
    hasMove: hasMove,
    applyMove: applyMove,
    undoMove: undoMove,
    countSide: countSide,
    chooseMove: chooseMove
  };
})();
