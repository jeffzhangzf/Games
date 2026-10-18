/* =========================================================
 * bricks/models.js — Brick Builder model library (blueprints)
 *
 * Purpose: every puzzle lives here as plain data. game.js only reads this
 *          file; no model is hard-coded elsewhere.
 *
 * Exposed globally (no build tools, so no import/export):
 *   window.BricksModels = { COLORS, SHAPES, list, byId, orient, brickCells, cellsKey, validate }
 *
 * Model format:
 *   {
 *     id: "duck",                  // unique, used by levels.js and localStorage
 *     name: "Rubber Duck",         // shown to players
 *     gridSize: { w: 6, h: 6 },    // in cells; keep w, h <= 10 so cells stay >= 32px on phones
 *     bricks: [ { x, y, shape, rot, color }, ... ],  // one known solution (see below)
 *     decoys: [ { shape, rot, color }, ... ],        // optional: extra tray bricks the picture doesn't need
 *     par: 90                      // optional: par time in seconds (default: pack's parPerBrick x bricks)
 *   }
 *   - shape: a key of SHAPES below; rot: 0-3 quarter turns clockwise
 *   - x / y: top-left corner of the rotated brick's bounding box, 0-based, y grows downward
 *   - color: a key of COLORS below (no arbitrary hex values)
 *
 * The picture itself is the union of all bricks: each covered cell takes its brick's color.
 * Players may solve it with ANY layout where every cell's color matches — the listed
 * bricks are just one guaranteed solution, and they decide which bricks the tray offers.
 *
 * The ASCII sketch above each model is the picture (one letter per cell):
 *   r red  b blue  g green  y yellow  w white  k black  o orange  p purple  i pink  n brown
 *
 * validate() runs on load and logs any overlap / out-of-bounds / bad color / bad shape
 * to the console, so a typo in a new model shows up immediately.
 * ========================================================= */

(function () {
  'use strict';

  /* ---------------- Palette ----------------
   * fill = brick face, edge = darker outline / stud shadow */
  var COLORS = {
    red:    { fill: '#e74c3c', edge: '#b83227' },
    blue:   { fill: '#3498db', edge: '#21618c' },
    green:  { fill: '#2ecc71', edge: '#1e8449' },
    yellow: { fill: '#f9d43a', edge: '#c9a20c' },
    white:  { fill: '#fdfdfd', edge: '#b8c0c8' },
    black:  { fill: '#34383d', edge: '#16181b' },
    orange: { fill: '#ff8c2b', edge: '#c8620c' },
    purple: { fill: '#9b59b6', edge: '#6c3483' },
    pink:   { fill: '#ff8fc2', edge: '#d6558f' },
    brown:  { fill: '#a0674b', edge: '#6e4330' }
  };

  /* ---------------- Brick shapes ----------------
   * Cells at rot 0 as [x, y]. The number in the key is the square count.
   * Packs without rotation still use every orientation; the tray just can't turn them. */
  var SHAPES = {
    I1: [[0, 0]],                                 // #
    I2: [[0, 0], [1, 0]],                         // ##
    I3: [[0, 0], [1, 0], [2, 0]],                 // ###
    I4: [[0, 0], [1, 0], [2, 0], [3, 0]],         // ####
    O4: [[0, 0], [1, 0], [0, 1], [1, 1]],         // ## / ##
    L3: [[0, 0], [0, 1], [1, 1]],                 // #. / ##
    T4: [[0, 0], [1, 0], [2, 0], [1, 1]],         // ### / .#.
    S4: [[1, 0], [2, 0], [0, 1], [1, 1]],         // .## / ##.
    Z4: [[0, 0], [1, 0], [1, 1], [2, 1]],         // ##. / .##
    L4: [[0, 0], [0, 1], [0, 2], [1, 2]],         // #. / #. / ##
    J4: [[1, 0], [1, 1], [1, 2], [0, 2]],         // .# / .# / ##
    P5: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], // ## / ## / #.
    U5: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], // #.# / ###
    V5: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], // #.. / #.. / ###
    L5: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]], // #. / #. / #. / ##
    T5: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]]  // ### / .#. / .#.
  };

  /* ---------------- Models ---------------- */
  var list = [

    /* ---------------- Starter Pack models ---------------- */

    // Rubber Duck — 9 bricks
    //   . . y y . .
    //   . y y k o .
    //   . . y y . .
    //   y . y y y .
    //   y y y y y .
    //   . y y y . .
    {
      id: "duck",
      name: "Rubber Duck",
      gridSize: { w: 6, h: 6 },
      bricks: [
        { x: 2, y: 0, shape: "I2", rot: 0, color: "yellow" },
        { x: 1, y: 1, shape: "I2", rot: 0, color: "yellow" },
        { x: 3, y: 1, shape: "I1", rot: 0, color: "black" },
        { x: 4, y: 1, shape: "I1", rot: 0, color: "orange" },
        { x: 2, y: 2, shape: "L3", rot: 2, color: "yellow" },
        { x: 0, y: 3, shape: "L3", rot: 0, color: "yellow" },
        { x: 2, y: 3, shape: "L3", rot: 0, color: "yellow" },
        { x: 4, y: 3, shape: "I2", rot: 1, color: "yellow" },
        { x: 1, y: 5, shape: "I3", rot: 0, color: "yellow" }
      ]
    },

    // Cozy House — 8 bricks
    //   . . r r . .
    //   . r r r r .
    //   r r r r r r
    //   . w b b w .
    //   . w n n w .
    //   . w n n w .
    {
      id: "house",
      name: "Cozy House",
      gridSize: { w: 6, h: 6 },
      bricks: [
        { x: 1, y: 0, shape: "L3", rot: 3, color: "red" },
        { x: 3, y: 0, shape: "I3", rot: 1, color: "red" },
        { x: 4, y: 1, shape: "L3", rot: 0, color: "red" },
        { x: 0, y: 2, shape: "I3", rot: 0, color: "red" },
        { x: 1, y: 3, shape: "I3", rot: 1, color: "white" },
        { x: 2, y: 3, shape: "I2", rot: 0, color: "blue" },
        { x: 4, y: 3, shape: "I3", rot: 1, color: "white" },
        { x: 2, y: 4, shape: "O4", rot: 0, color: "brown" }
      ]
    },

    // Little Tree — 7 bricks
    //   . . g g . .
    //   . g g g g .
    //   g g g g g g
    //   . g g g g .
    //   . . n n . .
    //   . . n n . .
    {
      id: "tree",
      name: "Little Tree",
      gridSize: { w: 6, h: 6 },
      bricks: [
        { x: 1, y: 0, shape: "L3", rot: 3, color: "green" },
        { x: 3, y: 0, shape: "I3", rot: 1, color: "green" },
        { x: 4, y: 1, shape: "L3", rot: 0, color: "green" },
        { x: 0, y: 2, shape: "I3", rot: 0, color: "green" },
        { x: 1, y: 3, shape: "I2", rot: 0, color: "green" },
        { x: 3, y: 3, shape: "I2", rot: 0, color: "green" },
        { x: 2, y: 4, shape: "O4", rot: 0, color: "brown" }
      ]
    },

    // Big Heart — 9 bricks
    //   . r r . r r .
    //   r r r r r r r
    //   r r r r r r r
    //   . r r r r r .
    //   . . r r r . .
    //   . . . r . . .
    {
      id: "heart",
      name: "Big Heart",
      gridSize: { w: 7, h: 6 },
      bricks: [
        { x: 1, y: 0, shape: "O4", rot: 0, color: "red" },
        { x: 4, y: 0, shape: "O4", rot: 0, color: "red" },
        { x: 0, y: 1, shape: "I2", rot: 1, color: "red" },
        { x: 3, y: 1, shape: "I3", rot: 1, color: "red" },
        { x: 6, y: 1, shape: "I2", rot: 1, color: "red" },
        { x: 1, y: 2, shape: "I2", rot: 1, color: "red" },
        { x: 2, y: 2, shape: "I3", rot: 1, color: "red" },
        { x: 4, y: 2, shape: "O4", rot: 0, color: "red" },
        { x: 3, y: 4, shape: "L3", rot: 1, color: "red" }
      ]
    },

    // Mushroom — 10 bricks
    //   . r r r r .
    //   r r w r r r
    //   r r r r w r
    //   . . w w . .
    //   . . w w . .
    //   . g g g g .
    {
      id: "mushroom",
      name: "Mushroom",
      gridSize: { w: 6, h: 6 },
      bricks: [
        { x: 0, y: 0, shape: "L3", rot: 3, color: "red" },
        { x: 2, y: 0, shape: "I3", rot: 0, color: "red" },
        { x: 2, y: 1, shape: "I1", rot: 0, color: "white" },
        { x: 3, y: 1, shape: "L3", rot: 1, color: "red" },
        { x: 5, y: 1, shape: "I2", rot: 1, color: "red" },
        { x: 0, y: 2, shape: "I3", rot: 0, color: "red" },
        { x: 4, y: 2, shape: "I1", rot: 0, color: "white" },
        { x: 2, y: 3, shape: "O4", rot: 0, color: "white" },
        { x: 1, y: 5, shape: "I2", rot: 0, color: "green" },
        { x: 3, y: 5, shape: "I2", rot: 0, color: "green" }
      ]
    },

    // Sailboat — 8 bricks
    //   . . . w . .
    //   . . w w . .
    //   . w w w . .
    //   . . . n . .
    //   n n n n n n
    //   b b b b b b
    {
      id: "sailboat",
      name: "Sailboat",
      gridSize: { w: 6, h: 6 },
      bricks: [
        { x: 3, y: 0, shape: "I3", rot: 1, color: "white" },
        { x: 1, y: 1, shape: "L3", rot: 3, color: "white" },
        { x: 2, y: 3, shape: "L3", rot: 3, color: "brown" },
        { x: 0, y: 4, shape: "I2", rot: 0, color: "brown" },
        { x: 4, y: 4, shape: "I2", rot: 0, color: "brown" },
        { x: 0, y: 5, shape: "I2", rot: 0, color: "blue" },
        { x: 2, y: 5, shape: "I2", rot: 0, color: "blue" },
        { x: 4, y: 5, shape: "I2", rot: 0, color: "blue" }
      ]
    },

    /* ---------------- Builder Pack models ---------------- */

    // Ginger Cat — 16 bricks
    //   o . . . . . . o
    //   o o . . . . o o
    //   o o o o o o o o
    //   o k o o o o k o
    //   o o o i i o o o
    //   o o w w w w o o
    //   . o o o o o o .
    //   . . o o o o . .
    {
      id: "cat",
      name: "Ginger Cat",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 0, y: 0, shape: "I4", rot: 1, color: "orange" },
        { x: 7, y: 0, shape: "I4", rot: 1, color: "orange" },
        { x: 1, y: 1, shape: "J4", rot: 1, color: "orange" },
        { x: 4, y: 1, shape: "L4", rot: 3, color: "orange" },
        { x: 1, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 2, y: 3, shape: "L4", rot: 1, color: "orange" },
        { x: 5, y: 3, shape: "L3", rot: 0, color: "orange" },
        { x: 6, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 0, y: 4, shape: "O4", rot: 0, color: "orange" },
        { x: 3, y: 4, shape: "I2", rot: 0, color: "pink" },
        { x: 7, y: 4, shape: "I2", rot: 1, color: "orange" },
        { x: 2, y: 5, shape: "I3", rot: 0, color: "white" },
        { x: 5, y: 5, shape: "I1", rot: 0, color: "white" },
        { x: 4, y: 5, shape: "L4", rot: 3, color: "orange" },
        { x: 1, y: 6, shape: "I3", rot: 0, color: "orange" },
        { x: 2, y: 7, shape: "I4", rot: 0, color: "orange" }
      ]
    },

    // Flower — 13 bricks
    //   . . p p p . .
    //   . p p y p p .
    //   p p y y y p p
    //   . p p y p p .
    //   . . p p p . .
    //   . . . g . . .
    //   g g . g . g g
    //   . g g g g g .
    {
      id: "flower",
      name: "Flower",
      gridSize: { w: 7, h: 8 },
      bricks: [
        { x: 2, y: 0, shape: "L4", rot: 1, color: "purple" },
        { x: 0, y: 1, shape: "L3", rot: 3, color: "purple" },
        { x: 2, y: 1, shape: "L3", rot: 3, color: "yellow" },
        { x: 4, y: 1, shape: "L4", rot: 2, color: "purple" },
        { x: 4, y: 2, shape: "I1", rot: 0, color: "yellow" },
        { x: 6, y: 2, shape: "I1", rot: 0, color: "purple" },
        { x: 1, y: 3, shape: "L3", rot: 2, color: "purple" },
        { x: 3, y: 3, shape: "I1", rot: 0, color: "yellow" },
        { x: 3, y: 3, shape: "L3", rot: 3, color: "purple" },
        { x: 2, y: 5, shape: "J4", rot: 0, color: "green" },
        { x: 0, y: 6, shape: "L3", rot: 2, color: "green" },
        { x: 5, y: 6, shape: "I2", rot: 0, color: "green" },
        { x: 4, y: 7, shape: "I2", rot: 0, color: "green" }
      ]
    },

    // Ice Cream — 13 bricks
    //   . i i i i .
    //   i i i i i i
    //   i w i i w i
    //   i i i i i i
    //   n n n n n n
    //   . n n n n .
    //   . n n n n .
    //   . . n n . .
    //   . . n n . .
    {
      id: "icecream",
      name: "Ice Cream",
      gridSize: { w: 6, h: 9 },
      bricks: [
        { x: 1, y: 0, shape: "O4", rot: 0, color: "pink" },
        { x: 3, y: 0, shape: "I4", rot: 1, color: "pink" },
        { x: 4, y: 0, shape: "L3", rot: 0, color: "pink" },
        { x: 0, y: 1, shape: "L4", rot: 0, color: "pink" },
        { x: 1, y: 2, shape: "I1", rot: 0, color: "white" },
        { x: 2, y: 2, shape: "I2", rot: 1, color: "pink" },
        { x: 4, y: 2, shape: "I1", rot: 0, color: "white" },
        { x: 4, y: 2, shape: "L3", rot: 3, color: "pink" },
        { x: 0, y: 4, shape: "J4", rot: 3, color: "brown" },
        { x: 3, y: 4, shape: "I3", rot: 0, color: "brown" },
        { x: 1, y: 5, shape: "J4", rot: 1, color: "brown" },
        { x: 3, y: 5, shape: "L3", rot: 2, color: "brown" },
        { x: 2, y: 7, shape: "O4", rot: 0, color: "brown" }
      ]
    },

    // Race Car — 12 bricks
    //   . . r r r r . .
    //   . r b b r b b .
    //   r r r r r r r r
    //   r r r r r r r y
    //   . k k . . k k .
    //   . k k . . k k .
    {
      id: "car",
      name: "Race Car",
      gridSize: { w: 8, h: 6 },
      bricks: [
        { x: 2, y: 0, shape: "I4", rot: 0, color: "red" },
        { x: 1, y: 1, shape: "L4", rot: 0, color: "red" },
        { x: 2, y: 1, shape: "I2", rot: 0, color: "blue" },
        { x: 2, y: 1, shape: "L4", rot: 3, color: "red" },
        { x: 5, y: 1, shape: "I2", rot: 0, color: "blue" },
        { x: 0, y: 2, shape: "I2", rot: 1, color: "red" },
        { x: 5, y: 2, shape: "I2", rot: 1, color: "red" },
        { x: 6, y: 2, shape: "L3", rot: 1, color: "red" },
        { x: 3, y: 3, shape: "I2", rot: 0, color: "red" },
        { x: 7, y: 3, shape: "I1", rot: 0, color: "yellow" },
        { x: 1, y: 4, shape: "O4", rot: 0, color: "black" },
        { x: 5, y: 4, shape: "O4", rot: 0, color: "black" }
      ]
    },

    // Robot — 13 bricks
    //   . . . r r . . .
    //   . . . b b . . .
    //   . b b b b b b .
    //   . b w b b w b .
    //   . b b b b b b .
    //   . b k k k k b .
    //   . b b b b b b .
    //   . k k . . k k .
    {
      id: "robot",
      name: "Robot",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 3, y: 0, shape: "I2", rot: 0, color: "red" },
        { x: 3, y: 1, shape: "L4", rot: 2, color: "blue" },
        { x: 1, y: 2, shape: "L4", rot: 0, color: "blue" },
        { x: 2, y: 2, shape: "L4", rot: 2, color: "blue" },
        { x: 5, y: 2, shape: "L3", rot: 2, color: "blue" },
        { x: 2, y: 3, shape: "I1", rot: 0, color: "white" },
        { x: 5, y: 3, shape: "I1", rot: 0, color: "white" },
        { x: 4, y: 4, shape: "J4", rot: 3, color: "blue" },
        { x: 1, y: 5, shape: "J4", rot: 1, color: "blue" },
        { x: 2, y: 5, shape: "I4", rot: 0, color: "black" },
        { x: 4, y: 6, shape: "I3", rot: 0, color: "blue" },
        { x: 1, y: 7, shape: "I2", rot: 0, color: "black" },
        { x: 5, y: 7, shape: "I2", rot: 0, color: "black" }
      ]
    },

    // Puppy — 17 bricks
    //   k k . . . . k k
    //   k k n n n n k k
    //   k n n n n n n k
    //   . n k n n k n .
    //   . n n n n n n .
    //   . n w k k w n .
    //   . . w w w w . .
    //   . . . i i . . .
    {
      id: "dog",
      name: "Puppy",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 0, y: 0, shape: "I3", rot: 1, color: "black" },
        { x: 1, y: 0, shape: "I2", rot: 1, color: "black" },
        { x: 6, y: 0, shape: "I2", rot: 0, color: "black" },
        { x: 2, y: 1, shape: "J4", rot: 3, color: "brown" },
        { x: 5, y: 1, shape: "L3", rot: 0, color: "brown" },
        { x: 6, y: 1, shape: "L3", rot: 2, color: "black" },
        { x: 1, y: 2, shape: "L4", rot: 1, color: "brown" },
        { x: 2, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 3, y: 3, shape: "J4", rot: 1, color: "brown" },
        { x: 4, y: 3, shape: "I1", rot: 0, color: "brown" },
        { x: 5, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 6, y: 3, shape: "I3", rot: 1, color: "brown" },
        { x: 1, y: 4, shape: "L3", rot: 1, color: "brown" },
        { x: 2, y: 5, shape: "I2", rot: 1, color: "white" },
        { x: 3, y: 5, shape: "I2", rot: 0, color: "black" },
        { x: 3, y: 5, shape: "L4", rot: 3, color: "white" },
        { x: 3, y: 7, shape: "I2", rot: 0, color: "pink" }
      ]
    },

    // Rocket — 14 bricks
    //   . . r r . .
    //   . r w w r .
    //   . w w w w .
    //   . w b b w .
    //   . w b b w .
    //   . w w w w .
    //   r w w w w r
    //   r w w w w r
    //   r . o o . r
    //   . . y y . .
    {
      id: "rocket",
      name: "Rocket",
      gridSize: { w: 6, h: 10 },
      bricks: [
        { x: 2, y: 0, shape: "I2", rot: 0, color: "red" },
        { x: 1, y: 1, shape: "I1", rot: 0, color: "red" },
        { x: 2, y: 1, shape: "O4", rot: 0, color: "white" },
        { x: 4, y: 1, shape: "I1", rot: 0, color: "red" },
        { x: 1, y: 2, shape: "I4", rot: 1, color: "white" },
        { x: 4, y: 2, shape: "I4", rot: 1, color: "white" },
        { x: 2, y: 3, shape: "O4", rot: 0, color: "blue" },
        { x: 2, y: 5, shape: "O4", rot: 0, color: "white" },
        { x: 0, y: 6, shape: "I3", rot: 1, color: "red" },
        { x: 1, y: 6, shape: "J4", rot: 1, color: "white" },
        { x: 4, y: 6, shape: "I2", rot: 1, color: "white" },
        { x: 5, y: 6, shape: "I3", rot: 1, color: "red" },
        { x: 2, y: 8, shape: "I2", rot: 0, color: "orange" },
        { x: 2, y: 9, shape: "I2", rot: 0, color: "yellow" }
      ]
    },

    // Castle — 18 bricks
    //   . p . . . . p .
    //   w w . . . . w w
    //   w w . w w . w w
    //   w w w w w w w w
    //   w b w w w w b w
    //   w w w n n w w w
    //   w w w n n w w w
    //   w w w n n w w w
    {
      id: "castle",
      name: "Castle",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 1, y: 0, shape: "I1", rot: 0, color: "purple" },
        { x: 6, y: 0, shape: "I1", rot: 0, color: "purple" },
        { x: 0, y: 1, shape: "L4", rot: 2, color: "white" },
        { x: 6, y: 1, shape: "L4", rot: 0, color: "white" },
        { x: 7, y: 1, shape: "I2", rot: 1, color: "white" },
        { x: 0, y: 2, shape: "I3", rot: 1, color: "white" },
        { x: 3, y: 2, shape: "J4", rot: 2, color: "white" },
        { x: 2, y: 3, shape: "I4", rot: 1, color: "white" },
        { x: 4, y: 3, shape: "O4", rot: 0, color: "white" },
        { x: 1, y: 4, shape: "I1", rot: 0, color: "blue" },
        { x: 6, y: 4, shape: "I1", rot: 0, color: "blue" },
        { x: 5, y: 4, shape: "L4", rot: 3, color: "white" },
        { x: 0, y: 5, shape: "J4", rot: 2, color: "white" },
        { x: 3, y: 5, shape: "J4", rot: 2, color: "brown" },
        { x: 1, y: 6, shape: "L3", rot: 0, color: "white" },
        { x: 4, y: 6, shape: "I2", rot: 1, color: "brown" },
        { x: 5, y: 6, shape: "O4", rot: 0, color: "white" },
        { x: 7, y: 6, shape: "I2", rot: 1, color: "white" }
      ]
    },

    /* ---------------- Architect Pack models ---------------- */

    // Crown — 14 bricks
    //   y . . y y . . y
    //   y y . y y . y y
    //   y y y y y y y y
    //   y r y y y y r y
    //   y y y b b y y y
    //   y y y y y y y y
    {
      id: "crown",
      name: "Crown",
      gridSize: { w: 8, h: 6 },
      bricks: [
        { x: 0, y: 0, shape: "S4", rot: 1, color: "yellow" },
        { x: 3, y: 0, shape: "O4", rot: 0, color: "yellow" },
        { x: 6, y: 0, shape: "Z4", rot: 1, color: "yellow" },
        { x: 0, y: 2, shape: "I4", rot: 1, color: "yellow" },
        { x: 2, y: 2, shape: "L4", rot: 1, color: "yellow" },
        { x: 5, y: 2, shape: "L4", rot: 0, color: "yellow" },
        { x: 7, y: 2, shape: "I3", rot: 1, color: "yellow" },
        { x: 1, y: 3, shape: "I1", rot: 0, color: "red" },
        { x: 3, y: 3, shape: "I2", rot: 0, color: "yellow" },
        { x: 6, y: 3, shape: "I1", rot: 0, color: "red" },
        { x: 1, y: 4, shape: "L3", rot: 1, color: "yellow" },
        { x: 3, y: 4, shape: "I2", rot: 0, color: "blue" },
        { x: 2, y: 5, shape: "I3", rot: 0, color: "yellow" },
        { x: 5, y: 5, shape: "I3", rot: 0, color: "yellow" }
      ]
    },

    // Apple — 14 bricks
    //   . . . . n . . .
    //   . . . . n g g .
    //   . r r r r r r .
    //   r r r r r r w r
    //   r r r r r r r r
    //   r r r r r r r r
    //   . r r r r r r .
    //   . . r r . r r .
    {
      id: "apple",
      name: "Apple",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 4, y: 0, shape: "I2", rot: 1, color: "brown" },
        { x: 5, y: 1, shape: "I2", rot: 0, color: "green" },
        { x: 1, y: 2, shape: "T4", rot: 0, color: "red" },
        { x: 4, y: 2, shape: "T4", rot: 3, color: "red" },
        { x: 5, y: 2, shape: "I2", rot: 0, color: "red" },
        { x: 0, y: 3, shape: "O4", rot: 0, color: "red" },
        { x: 3, y: 3, shape: "L4", rot: 0, color: "red" },
        { x: 6, y: 3, shape: "I1", rot: 0, color: "white" },
        { x: 6, y: 3, shape: "J4", rot: 0, color: "red" },
        { x: 1, y: 4, shape: "J4", rot: 0, color: "red" },
        { x: 5, y: 4, shape: "J4", rot: 2, color: "red" },
        { x: 0, y: 5, shape: "I2", rot: 0, color: "red" },
        { x: 2, y: 6, shape: "S4", rot: 0, color: "red" },
        { x: 5, y: 6, shape: "L3", rot: 3, color: "red" }
      ]
    },

    // Space Invader — 13 bricks
    //   . p . . . . p .
    //   . . p . . p . .
    //   . p p p p p p .
    //   p p . p p . p p
    //   p p p p p p p p
    //   p . p p p p . p
    //   p . p . . p . p
    //   . . . p p . . .
    {
      id: "invader",
      name: "Space Invader",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 1, y: 0, shape: "I1", rot: 0, color: "purple" },
        { x: 6, y: 0, shape: "I1", rot: 0, color: "purple" },
        { x: 1, y: 1, shape: "Z4", rot: 1, color: "purple" },
        { x: 5, y: 1, shape: "S4", rot: 1, color: "purple" },
        { x: 3, y: 2, shape: "L4", rot: 0, color: "purple" },
        { x: 4, y: 2, shape: "I2", rot: 1, color: "purple" },
        { x: 0, y: 3, shape: "J4", rot: 1, color: "purple" },
        { x: 6, y: 3, shape: "L3", rot: 3, color: "purple" },
        { x: 5, y: 4, shape: "I3", rot: 1, color: "purple" },
        { x: 0, y: 5, shape: "I2", rot: 1, color: "purple" },
        { x: 2, y: 5, shape: "L4", rot: 1, color: "purple" },
        { x: 7, y: 5, shape: "I2", rot: 1, color: "purple" },
        { x: 3, y: 7, shape: "I2", rot: 0, color: "purple" }
      ]
    },

    // Ghost — 18 bricks
    //   . . p p p p . .
    //   . p p p p p p .
    //   p w w p p w w p
    //   p w k p p w k p
    //   p p p p p p p p
    //   p p p p p p p p
    //   p p p p p p p p
    //   p p . p p . p p
    {
      id: "ghost",
      name: "Ghost",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 2, y: 0, shape: "Z4", rot: 0, color: "purple" },
        { x: 4, y: 0, shape: "Z4", rot: 0, color: "purple" },
        { x: 1, y: 1, shape: "I2", rot: 0, color: "purple" },
        { x: 0, y: 2, shape: "L4", rot: 0, color: "purple" },
        { x: 1, y: 2, shape: "L3", rot: 1, color: "white" },
        { x: 3, y: 2, shape: "J4", rot: 2, color: "purple" },
        { x: 5, y: 2, shape: "L3", rot: 1, color: "white" },
        { x: 7, y: 2, shape: "I4", rot: 1, color: "purple" },
        { x: 2, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 4, y: 3, shape: "L4", rot: 0, color: "purple" },
        { x: 6, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 0, y: 4, shape: "L4", rot: 3, color: "purple" },
        { x: 5, y: 4, shape: "L3", rot: 2, color: "purple" },
        { x: 2, y: 5, shape: "T4", rot: 2, color: "purple" },
        { x: 0, y: 6, shape: "O4", rot: 0, color: "purple" },
        { x: 5, y: 6, shape: "I3", rot: 0, color: "purple" },
        { x: 3, y: 7, shape: "I2", rot: 0, color: "purple" },
        { x: 6, y: 7, shape: "I2", rot: 0, color: "purple" }
      ]
    },

    // Coffee Mug — 15 bricks
    //   . w . . w . . .
    //   . . w . . w . .
    //   r r r r r r . .
    //   r r r r r r r r
    //   r w r r r r . r
    //   r w r r r r r r
    //   r r r r r r . .
    //   . r r r r . . .
    {
      id: "mug",
      name: "Coffee Mug",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 1, y: 0, shape: "I1", rot: 0, color: "white" },
        { x: 4, y: 0, shape: "I1", rot: 0, color: "white" },
        { x: 2, y: 1, shape: "I1", rot: 0, color: "white" },
        { x: 5, y: 1, shape: "I1", rot: 0, color: "white" },
        { x: 0, y: 2, shape: "J4", rot: 2, color: "red" },
        { x: 2, y: 2, shape: "I4", rot: 0, color: "red" },
        { x: 1, y: 3, shape: "I4", rot: 0, color: "red" },
        { x: 3, y: 3, shape: "L4", rot: 3, color: "red" },
        { x: 6, y: 3, shape: "L3", rot: 2, color: "red" },
        { x: 1, y: 4, shape: "I2", rot: 1, color: "white" },
        { x: 2, y: 4, shape: "I4", rot: 1, color: "red" },
        { x: 0, y: 5, shape: "S4", rot: 1, color: "red" },
        { x: 3, y: 5, shape: "Z4", rot: 0, color: "red" },
        { x: 5, y: 5, shape: "I3", rot: 0, color: "red" },
        { x: 3, y: 6, shape: "L3", rot: 0, color: "red" }
      ]
    },

    // Umbrella — 9 bricks
    //   . . r r r r . .
    //   . r y y y y r .
    //   r r r r r r r r
    //   r . r . . r . r
    //   . . . n . . . .
    //   . . . n . . . .
    //   . . . n . n . .
    //   . . . . n . . .
    {
      id: "umbrella",
      name: "Umbrella",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 2, y: 0, shape: "I4", rot: 0, color: "red" },
        { x: 0, y: 1, shape: "Z4", rot: 1, color: "red" },
        { x: 2, y: 1, shape: "I4", rot: 0, color: "yellow" },
        { x: 6, y: 1, shape: "S4", rot: 1, color: "red" },
        { x: 2, y: 2, shape: "L4", rot: 1, color: "red" },
        { x: 5, y: 2, shape: "I2", rot: 1, color: "red" },
        { x: 3, y: 4, shape: "I3", rot: 1, color: "brown" },
        { x: 5, y: 6, shape: "I1", rot: 0, color: "brown" },
        { x: 4, y: 7, shape: "I1", rot: 0, color: "brown" }
      ]
    },

    // Snowman — 17 bricks
    //   . . k k k . .
    //   . k k k k k .
    //   . w w w w w .
    //   . w k w k w .
    //   . w w o w w .
    //   r r r r r r r
    //   w w w k w w w
    //   w w w k w w w
    //   . w w w w w .
    {
      id: "snowman",
      name: "Snowman",
      gridSize: { w: 7, h: 9 },
      bricks: [
        { x: 1, y: 0, shape: "T4", rot: 2, color: "black" },
        { x: 3, y: 0, shape: "Z4", rot: 0, color: "black" },
        { x: 1, y: 2, shape: "J4", rot: 3, color: "white" },
        { x: 4, y: 2, shape: "L3", rot: 2, color: "white" },
        { x: 1, y: 3, shape: "L3", rot: 0, color: "white" },
        { x: 2, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 4, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 3, y: 4, shape: "I1", rot: 0, color: "orange" },
        { x: 4, y: 4, shape: "I2", rot: 0, color: "white" },
        { x: 0, y: 5, shape: "I4", rot: 0, color: "red" },
        { x: 4, y: 5, shape: "I3", rot: 0, color: "red" },
        { x: 0, y: 6, shape: "S4", rot: 1, color: "white" },
        { x: 1, y: 6, shape: "L4", rot: 2, color: "white" },
        { x: 3, y: 6, shape: "I2", rot: 1, color: "black" },
        { x: 4, y: 6, shape: "L4", rot: 1, color: "white" },
        { x: 3, y: 7, shape: "L4", rot: 3, color: "white" },
        { x: 6, y: 7, shape: "I1", rot: 0, color: "white" }
      ]
    },

    // Cupcake — 16 bricks
    //   . . . r . . . .
    //   . . i i i i . .
    //   . i i w i i i .
    //   i i i i i w i i
    //   i w i i i i i i
    //   . n o n o n o .
    //   . n o n o n o .
    //   . . o n o n . .
    {
      id: "cupcake",
      name: "Cupcake",
      gridSize: { w: 8, h: 8 },
      bricks: [
        { x: 3, y: 0, shape: "I1", rot: 0, color: "red" },
        { x: 2, y: 1, shape: "I4", rot: 1, color: "pink" },
        { x: 3, y: 1, shape: "L4", rot: 2, color: "pink" },
        { x: 5, y: 1, shape: "S4", rot: 1, color: "pink" },
        { x: 0, y: 2, shape: "Z4", rot: 1, color: "pink" },
        { x: 3, y: 2, shape: "I1", rot: 0, color: "white" },
        { x: 3, y: 3, shape: "J4", rot: 1, color: "pink" },
        { x: 5, y: 3, shape: "I1", rot: 0, color: "white" },
        { x: 6, y: 3, shape: "L3", rot: 3, color: "pink" },
        { x: 1, y: 4, shape: "I1", rot: 0, color: "white" },
        { x: 1, y: 5, shape: "I2", rot: 1, color: "brown" },
        { x: 2, y: 5, shape: "I3", rot: 1, color: "orange" },
        { x: 3, y: 5, shape: "I3", rot: 1, color: "brown" },
        { x: 4, y: 5, shape: "I3", rot: 1, color: "orange" },
        { x: 5, y: 5, shape: "I3", rot: 1, color: "brown" },
        { x: 6, y: 5, shape: "I2", rot: 1, color: "orange" }
      ]
    },

    /* ---------------- Master Pack models ---------------- */

    // Penguin — 23 bricks
    //   . . k k k k . .
    //   . k k k k k k .
    //   . k w k k w k .
    //   . k k o o k k .
    //   k k w w w w k k
    //   k w w w w w w k
    //   k w w w w w w k
    //   k w w w w w w k
    //   . k w w w w k .
    //   . o o . . o o .
    {
      id: "penguin",
      name: "Penguin",
      gridSize: { w: 8, h: 10 },
      bricks: [
        { x: 1, y: 0, shape: "Z4", rot: 1, color: "black" },
        { x: 3, y: 0, shape: "O4", rot: 0, color: "black" },
        { x: 5, y: 0, shape: "S4", rot: 1, color: "black" },
        { x: 2, y: 2, shape: "I1", rot: 0, color: "white" },
        { x: 3, y: 2, shape: "I2", rot: 0, color: "black" },
        { x: 5, y: 2, shape: "I1", rot: 0, color: "white" },
        { x: 0, y: 3, shape: "S4", rot: 0, color: "black" },
        { x: 3, y: 3, shape: "I2", rot: 0, color: "orange" },
        { x: 5, y: 3, shape: "Z4", rot: 0, color: "black" },
        { x: 2, y: 4, shape: "I4", rot: 0, color: "white" },
        { x: 0, y: 5, shape: "I3", rot: 1, color: "black" },
        { x: 1, y: 5, shape: "S4", rot: 1, color: "white" },
        { x: 2, y: 5, shape: "J4", rot: 3, color: "white" },
        { x: 5, y: 5, shape: "J4", rot: 2, color: "white" },
        { x: 7, y: 5, shape: "I3", rot: 1, color: "black" },
        { x: 2, y: 6, shape: "J4", rot: 0, color: "white" },
        { x: 6, y: 6, shape: "I2", rot: 1, color: "white" },
        { x: 1, y: 7, shape: "I1", rot: 0, color: "white" },
        { x: 4, y: 7, shape: "L3", rot: 0, color: "white" },
        { x: 1, y: 8, shape: "I1", rot: 0, color: "black" },
        { x: 6, y: 8, shape: "I1", rot: 0, color: "black" },
        { x: 1, y: 9, shape: "I2", rot: 0, color: "orange" },
        { x: 5, y: 9, shape: "I2", rot: 0, color: "orange" }
      ]
    },

    // Rainbow — 20 bricks
    //   . . r r r r r r . .
    //   . r o o o o o o r .
    //   r o y y y y y y o r
    //   r o y g g g g y o r
    //   r o y g b b g y o r
    //   r o y g . . g y o r
    //   w w w w . . w w w w
    {
      id: "rainbow",
      name: "Rainbow",
      gridSize: { w: 10, h: 7 },
      bricks: [
        { x: 2, y: 0, shape: "I4", rot: 0, color: "red" },
        { x: 6, y: 0, shape: "I2", rot: 0, color: "red" },
        { x: 1, y: 1, shape: "I1", rot: 0, color: "red" },
        { x: 2, y: 1, shape: "I3", rot: 0, color: "orange" },
        { x: 5, y: 1, shape: "I3", rot: 0, color: "orange" },
        { x: 8, y: 1, shape: "I1", rot: 0, color: "red" },
        { x: 0, y: 2, shape: "I4", rot: 1, color: "red" },
        { x: 1, y: 2, shape: "I4", rot: 1, color: "orange" },
        { x: 2, y: 2, shape: "L4", rot: 1, color: "yellow" },
        { x: 5, y: 2, shape: "I3", rot: 0, color: "yellow" },
        { x: 8, y: 2, shape: "I4", rot: 1, color: "orange" },
        { x: 9, y: 2, shape: "I4", rot: 1, color: "red" },
        { x: 3, y: 3, shape: "J4", rot: 2, color: "green" },
        { x: 5, y: 3, shape: "L4", rot: 2, color: "green" },
        { x: 7, y: 3, shape: "I3", rot: 1, color: "yellow" },
        { x: 2, y: 4, shape: "I2", rot: 1, color: "yellow" },
        { x: 4, y: 4, shape: "I2", rot: 0, color: "blue" },
        { x: 0, y: 6, shape: "I2", rot: 0, color: "white" },
        { x: 2, y: 6, shape: "I2", rot: 0, color: "white" },
        { x: 6, y: 6, shape: "I4", rot: 0, color: "white" }
      ]
    },

    // Clownfish — 17 bricks
    //   . . . o o o . . . .
    //   . . o o o w o . . o
    //   . o o o w w o o o o
    //   o k o o w w o w o o
    //   o o o o w w o w o o
    //   . o o o w w o o o o
    //   . . o o o w o . . o
    //   . . . o o o . . . .
    {
      id: "fish",
      name: "Clownfish",
      gridSize: { w: 10, h: 8 },
      bricks: [
        { x: 2, y: 0, shape: "T4", rot: 2, color: "orange" },
        { x: 4, y: 0, shape: "I2", rot: 0, color: "orange" },
        { x: 5, y: 1, shape: "I4", rot: 1, color: "white" },
        { x: 6, y: 1, shape: "T4", rot: 3, color: "orange" },
        { x: 8, y: 1, shape: "Z4", rot: 1, color: "orange" },
        { x: 1, y: 2, shape: "L4", rot: 2, color: "orange" },
        { x: 3, y: 2, shape: "I4", rot: 1, color: "orange" },
        { x: 4, y: 2, shape: "I4", rot: 1, color: "white" },
        { x: 0, y: 3, shape: "S4", rot: 1, color: "orange" },
        { x: 1, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 7, y: 3, shape: "I2", rot: 1, color: "white" },
        { x: 9, y: 3, shape: "I4", rot: 1, color: "orange" },
        { x: 6, y: 4, shape: "T4", rot: 3, color: "orange" },
        { x: 8, y: 4, shape: "I2", rot: 1, color: "orange" },
        { x: 2, y: 5, shape: "J4", rot: 1, color: "orange" },
        { x: 5, y: 5, shape: "I2", rot: 1, color: "white" },
        { x: 3, y: 7, shape: "I3", rot: 0, color: "orange" }
      ]
    },

    // Night Owl — 24 bricks
    //   n . . . . . . . . n
    //   n n . . . . . . n n
    //   n n n n n n n n n n
    //   n w w w n n w w w n
    //   n w k w n n w k w n
    //   n w w w o o w w w n
    //   . n n n o o n n n .
    //   . n y y y y y y n .
    //   . n y y y y y y n .
    //   . . o o . . o o . .
    {
      id: "owl",
      name: "Night Owl",
      gridSize: { w: 10, h: 10 },
      bricks: [
        { x: 0, y: 0, shape: "S4", rot: 1, color: "brown" },
        { x: 8, y: 0, shape: "Z4", rot: 1, color: "brown" },
        { x: 0, y: 2, shape: "I4", rot: 1, color: "brown" },
        { x: 2, y: 2, shape: "I4", rot: 0, color: "brown" },
        { x: 6, y: 2, shape: "I2", rot: 0, color: "brown" },
        { x: 9, y: 2, shape: "I4", rot: 1, color: "brown" },
        { x: 1, y: 3, shape: "J4", rot: 3, color: "white" },
        { x: 4, y: 3, shape: "O4", rot: 0, color: "brown" },
        { x: 6, y: 3, shape: "J4", rot: 2, color: "white" },
        { x: 7, y: 3, shape: "J4", rot: 0, color: "white" },
        { x: 1, y: 4, shape: "J4", rot: 1, color: "white" },
        { x: 2, y: 4, shape: "I1", rot: 0, color: "black" },
        { x: 7, y: 4, shape: "I1", rot: 0, color: "black" },
        { x: 4, y: 5, shape: "O4", rot: 0, color: "orange" },
        { x: 1, y: 6, shape: "I3", rot: 1, color: "brown" },
        { x: 2, y: 6, shape: "I2", rot: 0, color: "brown" },
        { x: 6, y: 6, shape: "J4", rot: 3, color: "brown" },
        { x: 2, y: 7, shape: "L4", rot: 1, color: "yellow" },
        { x: 5, y: 7, shape: "L4", rot: 1, color: "yellow" },
        { x: 3, y: 8, shape: "I2", rot: 0, color: "yellow" },
        { x: 6, y: 8, shape: "I2", rot: 0, color: "yellow" },
        { x: 8, y: 8, shape: "I1", rot: 0, color: "brown" },
        { x: 2, y: 9, shape: "I2", rot: 0, color: "orange" },
        { x: 6, y: 9, shape: "I2", rot: 0, color: "orange" }
      ]
    },

    // Pizza Slice — 17 bricks
    //   n n n n n n n n n n
    //   n y y y y y y y y n
    //   . y y r y y y y y .
    //   . y r r y y r r y .
    //   . . y r y y y y . .
    //   . . y y y r r y . .
    //   . . . y y r r . . .
    //   . . . y y y y . . .
    //   . . . . y y . . . .
    {
      id: "pizza",
      name: "Pizza Slice",
      gridSize: { w: 10, h: 9 },
      bricks: [
        { x: 0, y: 0, shape: "L4", rot: 1, color: "brown" },
        { x: 3, y: 0, shape: "I4", rot: 0, color: "brown" },
        { x: 7, y: 0, shape: "J4", rot: 3, color: "brown" },
        { x: 1, y: 1, shape: "J4", rot: 2, color: "yellow" },
        { x: 3, y: 1, shape: "T4", rot: 0, color: "yellow" },
        { x: 5, y: 1, shape: "S4", rot: 0, color: "yellow" },
        { x: 7, y: 1, shape: "T4", rot: 1, color: "yellow" },
        { x: 2, y: 2, shape: "I1", rot: 0, color: "yellow" },
        { x: 2, y: 2, shape: "T4", rot: 1, color: "red" },
        { x: 4, y: 3, shape: "I4", rot: 1, color: "yellow" },
        { x: 5, y: 3, shape: "L3", rot: 0, color: "yellow" },
        { x: 6, y: 3, shape: "I2", rot: 0, color: "red" },
        { x: 2, y: 4, shape: "S4", rot: 1, color: "yellow" },
        { x: 7, y: 4, shape: "I2", rot: 1, color: "yellow" },
        { x: 5, y: 5, shape: "O4", rot: 0, color: "red" },
        { x: 3, y: 7, shape: "Z4", rot: 0, color: "yellow" },
        { x: 5, y: 7, shape: "I2", rot: 0, color: "yellow" }
      ]
    },

    // Butterfly — 20 bricks
    //   p p . . k k . . p p
    //   p p p . k k . p p p
    //   p y p p k k p p y p
    //   p y y p k k p y y p
    //   p p p p k k p p p p
    //   . i i p k k p i i .
    //   . i i i k k i i i .
    //   . . i . k k . i . .
    {
      id: "butterfly",
      name: "Butterfly",
      gridSize: { w: 10, h: 8 },
      bricks: [
        { x: 0, y: 0, shape: "Z4", rot: 0, color: "purple" },
        { x: 4, y: 0, shape: "I4", rot: 1, color: "black" },
        { x: 5, y: 0, shape: "I4", rot: 1, color: "black" },
        { x: 7, y: 0, shape: "Z4", rot: 1, color: "purple" },
        { x: 9, y: 0, shape: "I4", rot: 1, color: "purple" },
        { x: 0, y: 1, shape: "I4", rot: 1, color: "purple" },
        { x: 1, y: 2, shape: "L3", rot: 0, color: "yellow" },
        { x: 2, y: 2, shape: "L4", rot: 2, color: "purple" },
        { x: 6, y: 2, shape: "I4", rot: 1, color: "purple" },
        { x: 7, y: 2, shape: "L3", rot: 3, color: "yellow" },
        { x: 1, y: 4, shape: "I2", rot: 0, color: "purple" },
        { x: 4, y: 4, shape: "I4", rot: 1, color: "black" },
        { x: 5, y: 4, shape: "I4", rot: 1, color: "black" },
        { x: 7, y: 4, shape: "I3", rot: 0, color: "purple" },
        { x: 1, y: 5, shape: "O4", rot: 0, color: "pink" },
        { x: 3, y: 5, shape: "I1", rot: 0, color: "purple" },
        { x: 6, y: 5, shape: "T4", rot: 1, color: "pink" },
        { x: 8, y: 5, shape: "I2", rot: 1, color: "pink" },
        { x: 3, y: 6, shape: "I1", rot: 0, color: "pink" },
        { x: 2, y: 7, shape: "I1", rot: 0, color: "pink" }
      ]
    },

    // Jet Plane — 20 bricks
    //   . . . . r r . . . .
    //   . . . r b b r . . .
    //   . . . w b b w . . .
    //   . . . w w w w . . .
    //   . r r w w w w r r .
    //   r r r w w w w r r r
    //   r r r w w w w r r r
    //   . o o w w w w o o .
    //   . . . w w w w . . .
    //   . r r r w w r r r .
    {
      id: "airplane",
      name: "Jet Plane",
      gridSize: { w: 10, h: 10 },
      bricks: [
        { x: 4, y: 0, shape: "I2", rot: 0, color: "red" },
        { x: 3, y: 1, shape: "I1", rot: 0, color: "red" },
        { x: 4, y: 1, shape: "O4", rot: 0, color: "blue" },
        { x: 6, y: 1, shape: "I1", rot: 0, color: "red" },
        { x: 3, y: 2, shape: "I4", rot: 1, color: "white" },
        { x: 5, y: 2, shape: "Z4", rot: 1, color: "white" },
        { x: 4, y: 3, shape: "I4", rot: 1, color: "white" },
        { x: 0, y: 4, shape: "Z4", rot: 1, color: "red" },
        { x: 1, y: 4, shape: "J4", rot: 0, color: "red" },
        { x: 6, y: 4, shape: "I4", rot: 1, color: "white" },
        { x: 7, y: 4, shape: "L4", rot: 2, color: "red" },
        { x: 4, y: 5, shape: "J4", rot: 0, color: "white" },
        { x: 7, y: 5, shape: "I2", rot: 1, color: "red" },
        { x: 9, y: 5, shape: "I2", rot: 1, color: "red" },
        { x: 3, y: 6, shape: "L4", rot: 0, color: "white" },
        { x: 1, y: 7, shape: "I2", rot: 0, color: "orange" },
        { x: 7, y: 7, shape: "I2", rot: 0, color: "orange" },
        { x: 4, y: 8, shape: "S4", rot: 0, color: "white" },
        { x: 1, y: 9, shape: "I3", rot: 0, color: "red" },
        { x: 6, y: 9, shape: "I3", rot: 0, color: "red" }
      ]
    },

    // Lighthouse — 21 bricks
    //   . . . . r r . . . .
    //   . . . r r r r . . .
    //   . . . y k k y . . .
    //   . . k k k k k k . .
    //   . . . r r r r . . .
    //   . . . r b r r . . .
    //   . . w w w w w w . .
    //   . . w w w w n w . .
    //   . r r r r n r r r .
    //   b b b n n n n b b b
    {
      id: "tower",
      name: "Lighthouse",
      gridSize: { w: 10, h: 10 },
      bricks: [
        { x: 3, y: 0, shape: "S4", rot: 0, color: "red" },
        { x: 5, y: 1, shape: "I2", rot: 0, color: "red" },
        { x: 3, y: 2, shape: "I1", rot: 0, color: "yellow" },
        { x: 4, y: 2, shape: "O4", rot: 0, color: "black" },
        { x: 6, y: 2, shape: "I1", rot: 0, color: "yellow" },
        { x: 2, y: 3, shape: "I2", rot: 0, color: "black" },
        { x: 6, y: 3, shape: "I2", rot: 0, color: "black" },
        { x: 3, y: 4, shape: "L4", rot: 1, color: "red" },
        { x: 5, y: 4, shape: "L3", rot: 3, color: "red" },
        { x: 4, y: 5, shape: "I1", rot: 0, color: "blue" },
        { x: 2, y: 6, shape: "T4", rot: 0, color: "white" },
        { x: 5, y: 6, shape: "J4", rot: 3, color: "white" },
        { x: 2, y: 7, shape: "I1", rot: 0, color: "white" },
        { x: 4, y: 7, shape: "I2", rot: 0, color: "white" },
        { x: 6, y: 7, shape: "I1", rot: 0, color: "brown" },
        { x: 1, y: 8, shape: "I4", rot: 0, color: "red" },
        { x: 5, y: 8, shape: "L3", rot: 0, color: "brown" },
        { x: 6, y: 8, shape: "I3", rot: 0, color: "red" },
        { x: 0, y: 9, shape: "I3", rot: 0, color: "blue" },
        { x: 3, y: 9, shape: "I2", rot: 0, color: "brown" },
        { x: 7, y: 9, shape: "I3", rot: 0, color: "blue" }
      ]
    },

    // Dino — 19 bricks
    //   . . . . . g g g g g
    //   . . . . g g k g g g
    //   . . . . g g g g g g
    //   . . . . g g g g . .
    //   g . . g g g g g g .
    //   g g . g g y y y g .
    //   g g g g g y y y . .
    //   . g g g g y y y . .
    //   . . g g g . g g . .
    //   . . k k k . k k . .
    {
      id: "dinosaur",
      name: "Dino",
      gridSize: { w: 10, h: 10 },
      bricks: [
        { x: 5, y: 0, shape: "L4", rot: 0, color: "green" },
        { x: 6, y: 0, shape: "Z4", rot: 0, color: "green" },
        { x: 8, y: 0, shape: "L4", rot: 2, color: "green" },
        { x: 4, y: 1, shape: "L4", rot: 0, color: "green" },
        { x: 6, y: 1, shape: "I1", rot: 0, color: "black" },
        { x: 7, y: 2, shape: "J4", rot: 2, color: "green" },
        { x: 4, y: 3, shape: "L4", rot: 3, color: "green" },
        { x: 0, y: 4, shape: "T4", rot: 3, color: "green" },
        { x: 2, y: 4, shape: "J4", rot: 0, color: "green" },
        { x: 8, y: 4, shape: "I2", rot: 1, color: "green" },
        { x: 4, y: 5, shape: "I4", rot: 1, color: "green" },
        { x: 5, y: 5, shape: "L4", rot: 0, color: "yellow" },
        { x: 6, y: 5, shape: "L4", rot: 2, color: "yellow" },
        { x: 1, y: 6, shape: "S4", rot: 1, color: "green" },
        { x: 6, y: 6, shape: "I1", rot: 0, color: "yellow" },
        { x: 3, y: 7, shape: "I2", rot: 1, color: "green" },
        { x: 6, y: 8, shape: "I2", rot: 0, color: "green" },
        { x: 2, y: 9, shape: "I3", rot: 0, color: "black" },
        { x: 6, y: 9, shape: "I2", rot: 0, color: "black" }
      ]
    },

    /* ---------------- Legend Pack models ---------------- */

    // Watermelon — 17 bricks + 3 decoys
    //   r r r r r r r r r r
    //   r r k r r r r k r r
    //   r r r r r r r r r r
    //   . r r r k r r r r .
    //   . w w r r r r w w .
    //   . . w w w w w w . .
    //   . . . g g g g . . .
    {
      id: "watermelon",
      name: "Watermelon",
      gridSize: { w: 10, h: 7 },
      bricks: [
        { x: 0, y: 0, shape: "T5", rot: 0, color: "red" },
        { x: 3, y: 0, shape: "T5", rot: 3, color: "red" },
        { x: 4, y: 0, shape: "V5", rot: 2, color: "red" },
        { x: 7, y: 0, shape: "L5", rot: 2, color: "red" },
        { x: 9, y: 0, shape: "I3", rot: 1, color: "red" },
        { x: 0, y: 1, shape: "I2", rot: 1, color: "red" },
        { x: 2, y: 1, shape: "I1", rot: 0, color: "black" },
        { x: 7, y: 1, shape: "I1", rot: 0, color: "black" },
        { x: 1, y: 2, shape: "T4", rot: 2, color: "red" },
        { x: 4, y: 2, shape: "U5", rot: 3, color: "red" },
        { x: 6, y: 2, shape: "Z4", rot: 1, color: "red" },
        { x: 4, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 1, y: 4, shape: "Z4", rot: 0, color: "white" },
        { x: 3, y: 4, shape: "I1", rot: 0, color: "red" },
        { x: 6, y: 4, shape: "S4", rot: 0, color: "white" },
        { x: 4, y: 5, shape: "I2", rot: 0, color: "white" },
        { x: 3, y: 6, shape: "I4", rot: 0, color: "green" }
      ],
      decoys: [
        { shape: "V5", rot: 3, color: "red" },
        { shape: "J4", rot: 2, color: "red" },
        { shape: "I4", rot: 0, color: "red" }
      ]
    },

    // Frog Prince — 22 bricks + 3 decoys
    //   . g g . . . . g g .
    //   g w k g . . g k w g
    //   g g g g g g g g g g
    //   g g g k g g k g g g
    //   g g g g g g g g g g
    //   g g i i i i i i g g
    //   . g g g g g g g g .
    //   g g . . . . . . g g
    {
      id: "frog",
      name: "Frog Prince",
      gridSize: { w: 10, h: 8 },
      bricks: [
        { x: 1, y: 0, shape: "I2", rot: 0, color: "green" },
        { x: 7, y: 0, shape: "I2", rot: 0, color: "green" },
        { x: 0, y: 1, shape: "L5", rot: 0, color: "green" },
        { x: 1, y: 1, shape: "I1", rot: 0, color: "white" },
        { x: 2, y: 1, shape: "I1", rot: 0, color: "black" },
        { x: 2, y: 1, shape: "T4", rot: 2, color: "green" },
        { x: 5, y: 1, shape: "Z4", rot: 1, color: "green" },
        { x: 7, y: 1, shape: "I1", rot: 0, color: "black" },
        { x: 8, y: 1, shape: "I1", rot: 0, color: "white" },
        { x: 8, y: 1, shape: "P5", rot: 2, color: "green" },
        { x: 1, y: 2, shape: "L3", rot: 0, color: "green" },
        { x: 5, y: 2, shape: "V5", rot: 3, color: "green" },
        { x: 3, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 2, y: 3, shape: "L4", rot: 3, color: "green" },
        { x: 6, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 8, y: 4, shape: "L5", rot: 0, color: "green" },
        { x: 9, y: 4, shape: "I2", rot: 1, color: "green" },
        { x: 0, y: 5, shape: "U5", rot: 3, color: "green" },
        { x: 2, y: 5, shape: "I4", rot: 0, color: "pink" },
        { x: 6, y: 5, shape: "I2", rot: 0, color: "pink" },
        { x: 2, y: 6, shape: "I4", rot: 0, color: "green" },
        { x: 6, y: 6, shape: "I2", rot: 0, color: "green" }
      ],
      decoys: [
        { shape: "T5", rot: 0, color: "green" },
        { shape: "T4", rot: 0, color: "green" },
        { shape: "L5", rot: 0, color: "green" }
      ]
    },

    // Hot Air Balloon — 18 bricks + 3 decoys
    //   . . y r r r y . .
    //   . y y r r r y y .
    //   r y y r r r y y r
    //   r y y r r r y y r
    //   r y y r r r y y r
    //   . y y r r r y y .
    //   . . y r r r y . .
    //   . . . k . k . . .
    //   . . . n n n . . .
    //   . . . n n n . . .
    {
      id: "balloon",
      name: "Hot Air Balloon",
      gridSize: { w: 9, h: 10 },
      bricks: [
        { x: 1, y: 0, shape: "P5", rot: 2, color: "yellow" },
        { x: 3, y: 0, shape: "L5", rot: 2, color: "red" },
        { x: 5, y: 0, shape: "I2", rot: 1, color: "red" },
        { x: 6, y: 0, shape: "T4", rot: 3, color: "yellow" },
        { x: 3, y: 1, shape: "I4", rot: 1, color: "red" },
        { x: 0, y: 2, shape: "I3", rot: 1, color: "red" },
        { x: 5, y: 2, shape: "I3", rot: 1, color: "red" },
        { x: 6, y: 2, shape: "Z4", rot: 1, color: "yellow" },
        { x: 8, y: 2, shape: "I3", rot: 1, color: "red" },
        { x: 1, y: 3, shape: "P5", rot: 0, color: "yellow" },
        { x: 3, y: 4, shape: "Z4", rot: 1, color: "red" },
        { x: 6, y: 4, shape: "Z4", rot: 1, color: "yellow" },
        { x: 2, y: 5, shape: "I2", rot: 1, color: "yellow" },
        { x: 4, y: 5, shape: "L3", rot: 3, color: "red" },
        { x: 3, y: 7, shape: "I1", rot: 0, color: "black" },
        { x: 5, y: 7, shape: "I1", rot: 0, color: "black" },
        { x: 3, y: 8, shape: "P5", rot: 1, color: "brown" },
        { x: 3, y: 9, shape: "I1", rot: 0, color: "brown" }
      ],
      decoys: [
        { shape: "J4", rot: 2, color: "red" },
        { shape: "L4", rot: 3, color: "brown" },
        { shape: "L3", rot: 2, color: "brown" }
      ]
    },

    // Treasure Chest — 22 bricks + 3 decoys
    //   . n n n n n n n n .
    //   n n n n n n n n n n
    //   n y y y y y y y y n
    //   k k k k y y k k k k
    //   n n n n y y n n n n
    //   n n n n n n n n n n
    //   n y y y y y y y y n
    //   n n n n n n n n n n
    {
      id: "chest",
      name: "Treasure Chest",
      gridSize: { w: 10, h: 8 },
      bricks: [
        { x: 1, y: 0, shape: "P5", rot: 1, color: "brown" },
        { x: 4, y: 0, shape: "P5", rot: 3, color: "brown" },
        { x: 6, y: 0, shape: "T4", rot: 0, color: "brown" },
        { x: 0, y: 1, shape: "I2", rot: 0, color: "brown" },
        { x: 8, y: 1, shape: "L3", rot: 2, color: "brown" },
        { x: 0, y: 2, shape: "I1", rot: 0, color: "brown" },
        { x: 1, y: 2, shape: "I4", rot: 0, color: "yellow" },
        { x: 4, y: 2, shape: "P5", rot: 2, color: "yellow" },
        { x: 6, y: 2, shape: "I3", rot: 0, color: "yellow" },
        { x: 0, y: 3, shape: "I3", rot: 0, color: "black" },
        { x: 3, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 6, y: 3, shape: "I4", rot: 0, color: "black" },
        { x: 0, y: 4, shape: "T5", rot: 3, color: "brown" },
        { x: 1, y: 4, shape: "J4", rot: 3, color: "brown" },
        { x: 6, y: 4, shape: "L5", rot: 1, color: "brown" },
        { x: 4, y: 5, shape: "I2", rot: 0, color: "brown" },
        { x: 7, y: 5, shape: "V5", rot: 2, color: "brown" },
        { x: 1, y: 6, shape: "I4", rot: 0, color: "yellow" },
        { x: 5, y: 6, shape: "I4", rot: 0, color: "yellow" },
        { x: 0, y: 7, shape: "I3", rot: 0, color: "brown" },
        { x: 3, y: 7, shape: "I4", rot: 0, color: "brown" },
        { x: 7, y: 7, shape: "I2", rot: 0, color: "brown" }
      ],
      decoys: [
        { shape: "L3", rot: 3, color: "brown" },
        { shape: "I3", rot: 0, color: "black" },
        { shape: "L5", rot: 1, color: "yellow" }
      ]
    },

    // Ladybug — 21 bricks + 3 decoys
    //   . . . k k k k . . .
    //   . . k k k k k k . .
    //   . r r r k k r r r .
    //   r r k r k k r k r r
    //   r r r r k k r r r r
    //   r k r r k k r r k r
    //   r r r r k k r r r r
    //   . r r k k k k r r .
    //   . . r r k k r r . .
    {
      id: "ladybug",
      name: "Ladybug",
      gridSize: { w: 10, h: 9 },
      bricks: [
        { x: 3, y: 0, shape: "P5", rot: 1, color: "black" },
        { x: 6, y: 0, shape: "L3", rot: 0, color: "black" },
        { x: 2, y: 1, shape: "I2", rot: 0, color: "black" },
        { x: 1, y: 2, shape: "U5", rot: 2, color: "red" },
        { x: 4, y: 2, shape: "P5", rot: 0, color: "black" },
        { x: 6, y: 2, shape: "U5", rot: 1, color: "red" },
        { x: 8, y: 2, shape: "T4", rot: 3, color: "red" },
        { x: 0, y: 3, shape: "L5", rot: 0, color: "red" },
        { x: 2, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 7, y: 3, shape: "I1", rot: 0, color: "black" },
        { x: 1, y: 4, shape: "V5", rot: 2, color: "red" },
        { x: 4, y: 4, shape: "P5", rot: 2, color: "black" },
        { x: 7, y: 4, shape: "V5", rot: 3, color: "red" },
        { x: 1, y: 5, shape: "I1", rot: 0, color: "black" },
        { x: 2, y: 5, shape: "L5", rot: 0, color: "red" },
        { x: 6, y: 5, shape: "L3", rot: 1, color: "red" },
        { x: 8, y: 5, shape: "I1", rot: 0, color: "black" },
        { x: 1, y: 7, shape: "I1", rot: 0, color: "red" },
        { x: 3, y: 7, shape: "I4", rot: 0, color: "black" },
        { x: 6, y: 7, shape: "S4", rot: 0, color: "red" },
        { x: 4, y: 8, shape: "I2", rot: 0, color: "black" }
      ],
      decoys: [
        { shape: "T5", rot: 1, color: "black" },
        { shape: "U5", rot: 3, color: "black" },
        { shape: "I3", rot: 1, color: "red" }
      ]
    },

    // Panda — 22 bricks + 3 decoys
    //   k k . . . . . . k k
    //   k k w w w w w w k k
    //   . w w w w w w w w .
    //   w k k w w w w k k w
    //   w k k w w w w k k w
    //   w w w w k k w w w w
    //   w i w w w w w w i w
    //   . w w w k k w w w .
    //   . . w w w w w w . .
    {
      id: "panda",
      name: "Panda",
      gridSize: { w: 10, h: 9 },
      bricks: [
        { x: 0, y: 0, shape: "O4", rot: 0, color: "black" },
        { x: 8, y: 0, shape: "O4", rot: 0, color: "black" },
        { x: 2, y: 1, shape: "P5", rot: 3, color: "white" },
        { x: 4, y: 1, shape: "U5", rot: 3, color: "white" },
        { x: 6, y: 1, shape: "P5", rot: 3, color: "white" },
        { x: 1, y: 2, shape: "I1", rot: 0, color: "white" },
        { x: 0, y: 3, shape: "I4", rot: 1, color: "white" },
        { x: 1, y: 3, shape: "O4", rot: 0, color: "black" },
        { x: 1, y: 3, shape: "V5", rot: 3, color: "white" },
        { x: 4, y: 3, shape: "T5", rot: 1, color: "white" },
        { x: 7, y: 3, shape: "O4", rot: 0, color: "black" },
        { x: 7, y: 3, shape: "V5", rot: 3, color: "white" },
        { x: 4, y: 5, shape: "I2", rot: 0, color: "black" },
        { x: 1, y: 6, shape: "I1", rot: 0, color: "pink" },
        { x: 2, y: 6, shape: "T5", rot: 0, color: "white" },
        { x: 5, y: 6, shape: "U5", rot: 3, color: "white" },
        { x: 7, y: 6, shape: "T4", rot: 3, color: "white" },
        { x: 8, y: 6, shape: "I1", rot: 0, color: "pink" },
        { x: 9, y: 6, shape: "I1", rot: 0, color: "white" },
        { x: 1, y: 7, shape: "L3", rot: 2, color: "white" },
        { x: 4, y: 7, shape: "I2", rot: 0, color: "black" },
        { x: 4, y: 8, shape: "I1", rot: 0, color: "white" }
      ],
      decoys: [
        { shape: "L5", rot: 3, color: "white" },
        { shape: "T4", rot: 3, color: "white" },
        { shape: "T5", rot: 2, color: "white" }
      ]
    },

    // Parrot — 14 bricks + 3 decoys
    //   . . r r r r . .
    //   . r r r r r r .
    //   . r w k r r k k
    //   . r r r r r k k
    //   . r r r r r r .
    //   . . y y r r r .
    //   . . y b b r r .
    //   . . y b b r r .
    //   . . . b b r . .
    //   . . . b b . . .
    {
      id: "parrot",
      name: "Parrot",
      gridSize: { w: 8, h: 10 },
      bricks: [
        { x: 2, y: 0, shape: "V5", rot: 2, color: "red" },
        { x: 5, y: 0, shape: "T4", rot: 3, color: "red" },
        { x: 1, y: 1, shape: "V5", rot: 1, color: "red" },
        { x: 2, y: 2, shape: "I1", rot: 0, color: "white" },
        { x: 3, y: 2, shape: "I1", rot: 0, color: "black" },
        { x: 6, y: 2, shape: "O4", rot: 0, color: "black" },
        { x: 2, y: 3, shape: "V5", rot: 2, color: "red" },
        { x: 5, y: 3, shape: "S4", rot: 1, color: "red" },
        { x: 1, y: 4, shape: "I3", rot: 0, color: "red" },
        { x: 2, y: 5, shape: "J4", rot: 2, color: "yellow" },
        { x: 5, y: 5, shape: "S4", rot: 1, color: "red" },
        { x: 3, y: 6, shape: "P5", rot: 0, color: "blue" },
        { x: 5, y: 7, shape: "I2", rot: 1, color: "red" },
        { x: 3, y: 8, shape: "L3", rot: 3, color: "blue" }
      ],
      decoys: [
        { shape: "L3", rot: 0, color: "black" },
        { shape: "I3", rot: 1, color: "red" },
        { shape: "L4", rot: 0, color: "blue" }
      ]
    },

    // Cactus — 14 bricks + 3 decoys
    //   . . . i i . . .
    //   . . . g g . . .
    //   g . . g g . . .
    //   g . . g g . . g
    //   g g g g g . . g
    //   . . . g g g g g
    //   . . . g g . . .
    //   . o o o o o o .
    //   . o o o o o o .
    //   . . o o o o . .
    {
      id: "cactus",
      name: "Cactus",
      gridSize: { w: 8, h: 10 },
      bricks: [
        { x: 3, y: 0, shape: "I2", rot: 0, color: "pink" },
        { x: 3, y: 1, shape: "L5", rot: 0, color: "green" },
        { x: 4, y: 1, shape: "I3", rot: 1, color: "green" },
        { x: 0, y: 2, shape: "L4", rot: 0, color: "green" },
        { x: 6, y: 3, shape: "J4", rot: 0, color: "green" },
        { x: 2, y: 4, shape: "I1", rot: 0, color: "green" },
        { x: 3, y: 5, shape: "T4", rot: 0, color: "green" },
        { x: 3, y: 6, shape: "I1", rot: 0, color: "green" },
        { x: 1, y: 7, shape: "U5", rot: 0, color: "orange" },
        { x: 2, y: 7, shape: "I1", rot: 0, color: "orange" },
        { x: 4, y: 7, shape: "T5", rot: 3, color: "orange" },
        { x: 5, y: 7, shape: "I2", rot: 0, color: "orange" },
        { x: 2, y: 9, shape: "I2", rot: 0, color: "orange" },
        { x: 5, y: 9, shape: "I1", rot: 0, color: "orange" }
      ],
      decoys: [
        { shape: "T5", rot: 2, color: "orange" },
        { shape: "T5", rot: 1, color: "green" },
        { shape: "J4", rot: 0, color: "orange" }
      ]
    },

    // Sunset Sea — 22 bricks + 3 decoys
    //   p p p p p p p p p p
    //   p p p y y y y p p p
    //   p p y y y y y y p p
    //   o o y y y y y y o o
    //   o o o o o o o o o o
    //   b b b b b b b b b b
    //   b w b b b b w b b b
    //   b b b b b b b b b b
    {
      id: "sunset",
      name: "Sunset Sea",
      gridSize: { w: 10, h: 8 },
      bricks: [
        { x: 0, y: 0, shape: "U5", rot: 2, color: "purple" },
        { x: 3, y: 0, shape: "I4", rot: 0, color: "purple" },
        { x: 7, y: 0, shape: "V5", rot: 2, color: "purple" },
        { x: 0, y: 1, shape: "L3", rot: 3, color: "purple" },
        { x: 3, y: 1, shape: "T5", rot: 3, color: "yellow" },
        { x: 4, y: 1, shape: "J4", rot: 3, color: "yellow" },
        { x: 7, y: 1, shape: "L3", rot: 2, color: "purple" },
        { x: 2, y: 2, shape: "I2", rot: 1, color: "yellow" },
        { x: 4, y: 2, shape: "L5", rot: 3, color: "yellow" },
        { x: 0, y: 3, shape: "P5", rot: 3, color: "orange" },
        { x: 5, y: 3, shape: "L5", rot: 3, color: "orange" },
        { x: 9, y: 3, shape: "I2", rot: 1, color: "orange" },
        { x: 3, y: 4, shape: "I2", rot: 0, color: "orange" },
        { x: 0, y: 5, shape: "V5", rot: 1, color: "blue" },
        { x: 3, y: 5, shape: "T5", rot: 0, color: "blue" },
        { x: 6, y: 5, shape: "V5", rot: 2, color: "blue" },
        { x: 9, y: 5, shape: "I3", rot: 1, color: "blue" },
        { x: 1, y: 6, shape: "I1", rot: 0, color: "white" },
        { x: 1, y: 6, shape: "S4", rot: 0, color: "blue" },
        { x: 5, y: 6, shape: "U5", rot: 0, color: "blue" },
        { x: 6, y: 6, shape: "I1", rot: 0, color: "white" },
        { x: 3, y: 7, shape: "I1", rot: 0, color: "blue" }
      ],
      decoys: [
        { shape: "L3", rot: 2, color: "blue" },
        { shape: "P5", rot: 2, color: "blue" },
        { shape: "J4", rot: 0, color: "blue" }
      ]
    }
  ];

  /* ---------------- Helpers ---------------- */

  // Shift cells so the bounding box starts at 0,0; sort in reading order (top row first)
  function normalize(cells) {
    var mx = Infinity;
    var my = Infinity;
    cells.forEach(function (c) { mx = Math.min(mx, c[0]); my = Math.min(my, c[1]); });
    return cells
      .map(function (c) { return [c[0] - mx, c[1] - my]; })
      .sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  }

  var orientCache = {};

  /** Cells of a shape after `rot` quarter turns clockwise, normalized, in reading order. */
  function orient(shape, rot) {
    var key = shape + '/' + rot;
    if (!orientCache[key]) {
      var cells = normalize(SHAPES[shape]);
      for (var i = 0; i < rot; i++) {
        cells = normalize(cells.map(function (c) { return [-c[1], c[0]]; }));
      }
      orientCache[key] = cells;
    }
    return orientCache[key];
  }

  /** Cells a brick covers, as [dx, dy] offsets from its x / y. */
  function brickCells(b) {
    return b.cells || orient(b.shape, b.rot || 0);
  }

  /** Text key of a cell list — equal keys mean the same oriented shape. */
  function cellsKey(cells) {
    return cells.map(function (c) { return c[0] + ',' + c[1]; }).join(' ');
  }

  /* ---------------- Validation ---------------- */

  /**
   * Check one model for data mistakes.
   * @returns {string[]} list of problems (empty = OK)
   */
  function validate(model) {
    var errors = [];
    var gw = model.gridSize.w;
    var gh = model.gridSize.h;
    var occupied = {};

    model.bricks.forEach(function (b, i) {
      var tag = model.id + ' brick #' + i;
      if (!COLORS[b.color]) errors.push(tag + ': unknown color "' + b.color + '"');
      if (!SHAPES[b.shape]) { errors.push(tag + ': unknown shape "' + b.shape + '"'); return; }
      if (!(b.rot >= 0 && b.rot <= 3)) errors.push(tag + ': rot must be 0-3');
      brickCells(b).forEach(function (c) {
        var x = b.x + c[0];
        var y = b.y + c[1];
        var key = x + ',' + y;
        if (x < 0 || y < 0 || x >= gw || y >= gh) errors.push(tag + ': out of bounds at ' + key);
        if (occupied[key] !== undefined) errors.push(tag + ': overlaps brick #' + occupied[key] + ' at ' + key);
        occupied[key] = i;
      });
    });
    (model.decoys || []).forEach(function (d, i) {
      if (!SHAPES[d.shape] || !COLORS[d.color]) errors.push(model.id + ' decoy #' + i + ': bad shape or color');
    });
    if (gw > 10 || gh > 10) errors.push(model.id + ': grid larger than 10x10');
    return errors;
  }

  var byId = {};
  list.forEach(function (m) {
    if (byId[m.id]) console.warn('[bricks] duplicate model id: ' + m.id);
    byId[m.id] = m;
    validate(m).forEach(function (e) { console.warn('[bricks] ' + e); });
  });

  window.BricksModels = {
    COLORS: COLORS,
    SHAPES: SHAPES,
    list: list,
    byId: byId,
    orient: orient,
    brickCells: brickCells,
    cellsKey: cellsKey,
    validate: validate
  };
})();
