/* =========================================================
 * bricks/levels.js — Brick Builder packs and their rules
 *
 * Purpose: groups models (ids from models.js) into packs, sets how many
 *          total stars unlock each pack, and switches puzzle mechanics on
 *          per pack so difficulty ramps up. Pack order = display order.
 *
 * Pack fields:
 *   id, name, requiredStars, models: [modelId, ...]
 *   rules:
 *     rotate       true = tap a tray brick to rotate it 90°
 *     parPerBrick  seconds per brick used to compute a model's par time
 *                  (a model can override it with its own `par` field, in seconds)
 *   tip: { title, text } shown once, on the first level played in the pack
 *
 * The build grid never shows any guide (no outlines, colors or shading): players
 * work only from the blueprint. Difficulty comes from picture size, brick shapes,
 * rotation and decoys.
 *
 * Star budget (3 stars per level: built it / no hints / under par time):
 *   Starter 6 levels = 18 max  -> Builder needs 8
 *   + Builder 8      = 42 max  -> Architect needs 25
 *   + Architect 8    = 66 max  -> Master needs 45
 *   + Master 9       = 93 max  -> Legend needs 70
 *   Every threshold is reachable without the "double stars" ad, with slack.
 *
 * Exposed globally:
 *   window.BricksLevels = { packs: [...] }
 * ========================================================= */

(function () {
  'use strict';

  window.BricksLevels = {
    packs: [
      {
        id: 'starter',
        name: 'Starter Pack',
        requiredStars: 0,
        rules: { rotate: false, parPerBrick: 8 },
        tip: {
          title: 'How to build',
          text: 'Copy the blueprint onto the empty grid using the bricks in the tray. Any layout works, as long as every square lands on its own color.'
        },
        models: ['duck', 'house', 'tree', 'heart', 'mushroom', 'sailboat']
      },
      {
        id: 'builder',
        name: 'Builder Pack',
        requiredStars: 8,
        rules: { rotate: false, parPerBrick: 10 },
        tip: {
          title: 'Bigger bricks',
          text: 'Longer bricks join the tray. Stuck? Tap a placed brick to take it back, or use Undo.'
        },
        models: ['cat', 'flower', 'icecream', 'car', 'robot', 'dog', 'rocket', 'castle']
      },
      {
        id: 'architect',
        name: 'Architect Pack',
        requiredStars: 25,
        rules: { rotate: true, parPerBrick: 12 },
        tip: {
          title: 'New: rotation',
          text: 'Tap a brick in the tray to rotate it. On a computer you can also press R while dragging.'
        },
        models: ['crown', 'apple', 'invader', 'ghost', 'mug', 'umbrella', 'snowman', 'cupcake']
      },
      {
        id: 'master',
        name: 'Master Pack',
        requiredStars: 45,
        rules: { rotate: true, parPerBrick: 12 },
        tip: {
          title: 'Big pictures',
          text: 'Bigger blueprints, more squares to count. Tap the blueprint to zoom in.'
        },
        models: ['penguin', 'rainbow', 'fish', 'owl', 'pizza', 'butterfly', 'airplane', 'tower', 'dinosaur']
      },
      {
        id: 'legend',
        name: 'Legend Pack',
        requiredStars: 70,
        rules: { rotate: true, parPerBrick: 14 },
        tip: {
          title: 'Watch out for decoys',
          text: 'Five-square bricks join the party, and some bricks in the tray are decoys you won\'t need. Fill the picture and you win.'
        },
        models: ['watermelon', 'frog', 'balloon', 'chest', 'ladybug', 'panda', 'parrot', 'cactus', 'sunset']
      }
    ]
  };

  // Catch typos: every model id in a pack must exist in models.js
  if (window.BricksModels) {
    window.BricksLevels.packs.forEach(function (pack) {
      pack.models.forEach(function (id) {
        if (!window.BricksModels.byId[id]) console.warn('[bricks] pack "' + pack.id + '" references unknown model: ' + id);
      });
    });
  }
})();
