/* =========================================================
 * bricks/tools/make-model.js — turn pixel art into a Brick Builder model
 *
 * Dev-only helper (the game never loads it). Plain Node, no npm packages.
 *
 * Usage:
 *   node bricks/tools/make-model.js <art.txt> --id cat --name "Ginger Cat" --pack 2
 *
 * art.txt: one row per line, one letter per cell, '.' = empty (max 10 x 10):
 *   r red  b blue  g green  y yellow  w white  k black  o orange  p purple  i pink  n brown
 *
 * --pack 1-5 picks the brick shapes to cut the picture into (same as the shipped packs):
 *   1  small bricks (1-3 squares, 2x2, small L), aim 6-10 bricks
 *   2  + 4-long bars and L/J, aim 9-18
 *   3  + T/S/Z four-square bricks, aim 9-18      (packs 3+ let players rotate)
 *   4  same shapes, bigger pictures, aim 13-24
 *   5  + five-square bricks and 3 decoys, aim 13-24
 *
 * It tries many random cuts, keeps the best-scoring one (count in range, few 1x1s,
 * varied shapes) and prints a model object to paste into the `list` in models.js.
 * The picture is solvable by construction; models.js validate() re-checks it on load.
 * ========================================================= */

'use strict';

var fs = require('fs');

var LETTERS = { r: 'red', b: 'blue', g: 'green', y: 'yellow', w: 'white', k: 'black', o: 'orange', p: 'purple', i: 'pink', n: 'brown' };

// Must match SHAPES in models.js
var SHAPES = {
  I1: [[0, 0]], I2: [[0, 0], [1, 0]], I3: [[0, 0], [1, 0], [2, 0]], I4: [[0, 0], [1, 0], [2, 0], [3, 0]],
  O4: [[0, 0], [1, 0], [0, 1], [1, 1]], L3: [[0, 0], [0, 1], [1, 1]],
  T4: [[0, 0], [1, 0], [2, 0], [1, 1]], S4: [[1, 0], [2, 0], [0, 1], [1, 1]], Z4: [[0, 0], [1, 0], [1, 1], [2, 1]],
  L4: [[0, 0], [0, 1], [0, 2], [1, 2]], J4: [[1, 0], [1, 1], [1, 2], [0, 2]],
  P5: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], U5: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  V5: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], L5: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  T5: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]]
};

var SMALL = ['I1', 'I2', 'I3', 'O4', 'L3'];
var TETRA = ['I1', 'I2', 'I3', 'L3', 'O4', 'I4', 'T4', 'S4', 'Z4', 'L4', 'J4'];
var PACKS = {
  1: { shapes: SMALL, range: [6, 10], target: 8 },
  2: { shapes: SMALL.concat(['I4', 'L4', 'J4']), range: [9, 18], target: 13 },
  3: { shapes: TETRA, range: [9, 18], target: 13, tetra: 3 },
  4: { shapes: TETRA, range: [13, 24], target: 18, tetra: 4 },
  5: { shapes: TETRA.concat(['P5', 'U5', 'V5', 'L5', 'T5']), range: [13, 24], target: 17, tetra: 3, penta: 3, decoys: 3 }
};
var TRIES = 20000;

/* ---------------- Shapes (same rotation rule as models.js orient) ---------------- */

function normalize(cells) {
  var mx = Math.min.apply(null, cells.map(function (c) { return c[0]; }));
  var my = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
  return cells.map(function (c) { return [c[0] - mx, c[1] - my]; })
    .sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
}

function orient(shape, rot) {
  var cells = normalize(SHAPES[shape]);
  for (var i = 0; i < rot; i++) cells = normalize(cells.map(function (c) { return [-c[1], c[0]]; }));
  return cells;
}

// Every distinct (shape, rot) pair allowed in a pack
function options(shapes) {
  var out = [];
  shapes.forEach(function (s) {
    var seen = {};
    for (var r = 0; r < 4; r++) {
      var cells = orient(s, r);
      var key = JSON.stringify(cells);
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ shape: s, rot: r, cells: cells });
    }
  });
  return out;
}

/* ---------------- Random tiling + scoring ---------------- */

// Fill the picture in reading order; at each empty square try shapes (big ones first, with noise)
function tile(art, w, h, opts, packNo) {
  var used = art.map(function (row) { return row.split('').map(function (c) { return c === '.'; }); });
  var bricks = [];
  var bias = packNo >= 3 ? 1.6 : 0.6;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (used[y][x]) continue;
      var color = art[y][x];
      var order = opts.map(function (o) { return [o, o.cells.length * bias + Math.random() * 4]; })
        .sort(function (a, b) { return b[1] - a[1]; })
        .map(function (a) { return a[0]; });
      for (var k = 0; k < order.length; k++) {
        var o = order[k];
        var ox = x - o.cells[0][0];
        var oy = y - o.cells[0][1];
        var fits = o.cells.every(function (c) {
          var cx = ox + c[0];
          var cy = oy + c[1];
          return cx >= 0 && cy >= 0 && cx < w && cy < h && !used[cy][cx] && art[cy][cx] === color;
        });
        if (!fits) continue;
        o.cells.forEach(function (c) { used[oy + c[1]][ox + c[0]] = true; });
        bricks.push({ x: ox, y: oy, shape: o.shape, rot: o.rot, color: LETTERS[color], size: o.cells.length });
        break;
      }
    }
  }
  return bricks;
}

function score(bricks, pack) {
  var n = bricks.length;
  var shapes = {};
  var tetra = {};
  var ones = 0;
  var penta = 0;
  bricks.forEach(function (b) {
    shapes[b.shape] = true;
    if (b.size === 1) ones++;
    if (b.size === 4 && b.shape !== 'O4') tetra[b.shape] = true;
    if (b.size === 5) penta++;
  });
  var s = (n < pack.range[0] || n > pack.range[1] ? -1000 : 0) - Math.abs(n - pack.target) * 0.6 +
    Object.keys(shapes).length * 2 - ones * 5;
  if (pack.tetra) s -= Math.max(0, pack.tetra - Object.keys(tetra).length) * 6;
  if (pack.penta) s -= Math.max(0, pack.penta - penta) * 6;
  return s;
}

// Decoys: extra bricks in the picture's main colors that fit somewhere in a region of that color
function makeDecoys(art, w, h, pack) {
  var counts = {};
  art.join('').split('').forEach(function (c) { if (c !== '.') counts[c] = (counts[c] || 0) + 1; });
  var colors = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  var opts = options(pack.shapes).filter(function (o) { return o.cells.length >= 3; });
  var out = [];
  for (var guard = 0; out.length < pack.decoys && guard < 5000; guard++) {
    var c = colors[Math.floor(Math.random() * Math.min(3, colors.length))];
    var o = opts[Math.floor(Math.random() * opts.length)];
    var fits = false;
    for (var y = 0; y < h && !fits; y++) {
      for (var x = 0; x < w && !fits; x++) {
        fits = o.cells.every(function (q) { return x + q[0] < w && y + q[1] < h && art[y + q[1]][x + q[0]] === c; });
      }
    }
    var dup = out.some(function (d) { return d.shape === o.shape && d.color === LETTERS[c]; });
    if (fits && !dup) out.push({ shape: o.shape, rot: o.rot, color: LETTERS[c] });
  }
  return out;
}

/* ---------------- CLI ---------------- */

function arg(name, fallback) {
  var i = process.argv.indexOf('--' + name);
  return i === -1 ? fallback : process.argv[i + 1];
}

function main() {
  var file = process.argv[2];
  if (!file || file.indexOf('--') === 0) {
    console.error('Usage: node bricks/tools/make-model.js <art.txt> --id cat --name "Ginger Cat" --pack 2');
    process.exit(1);
  }
  var art = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  var w = art[0].length;
  var h = art.length;
  art.forEach(function (row, i) {
    if (row.length !== w) throw new Error('Row ' + (i + 1) + ' has ' + row.length + ' cells, expected ' + w);
    row.split('').forEach(function (c) {
      if (c !== '.' && !LETTERS[c]) throw new Error('Unknown letter "' + c + '" in row ' + (i + 1));
    });
  });
  if (w > 10 || h > 10) throw new Error('Pictures can be at most 10 x 10 (cells must stay >= 32px on phones)');

  var packNo = parseInt(arg('pack', '3'), 10);
  var pack = PACKS[packNo];
  if (!pack) throw new Error('--pack must be 1-5');
  var opts = options(pack.shapes);

  var best = null;
  var bestScore = -Infinity;
  for (var t = 0; t < TRIES; t++) {
    var b = tile(art, w, h, opts, packNo);
    var s = score(b, pack);
    if (s > bestScore) {
      bestScore = s;
      best = b;
    }
  }
  if (bestScore < -500) {
    console.error('Warning: brick count ' + best.length + ' is outside ' + pack.range.join('-') +
      ' for pack ' + packNo + '. Try bigger single-color areas, or another --pack.');
  }

  var id = arg('id', 'my-model');
  var name = arg('name', 'My Model');
  var decoys = pack.decoys ? makeDecoys(art, w, h, pack) : [];
  var lines = [];
  lines.push('    // ' + name + ' — ' + best.length + ' bricks' + (decoys.length ? ' + ' + decoys.length + ' decoys' : ''));
  art.forEach(function (row) { lines.push('    //   ' + row.split('').join(' ')); });
  lines.push('    {');
  lines.push('      id: "' + id + '",');
  lines.push('      name: "' + name + '",');
  lines.push('      gridSize: { w: ' + w + ', h: ' + h + ' },');
  lines.push('      bricks: [');
  lines.push(best.map(function (b) {
    return '        { x: ' + b.x + ', y: ' + b.y + ', shape: "' + b.shape + '", rot: ' + b.rot + ', color: "' + b.color + '" }';
  }).join(',\n'));
  lines.push('      ]' + (decoys.length ? ',' : ''));
  if (decoys.length) {
    lines.push('      decoys: [');
    lines.push(decoys.map(function (d) {
      return '        { shape: "' + d.shape + '", rot: ' + d.rot + ', color: "' + d.color + '" }';
    }).join(',\n'));
    lines.push('      ]');
  }
  lines.push('    },');
  console.log(lines.join('\n'));
}

main();
