/* =========================================================
 * quiz/data.js — Personality Quiz content (questions + results)
 *
 * Purpose: all quiz text lives here (English UI, written for English-speaking gamers).
 *          quiz.js only reads this object, so adding/editing questions or
 *          results never touches the logic.
 *
 * Exposed as a global (this project has no build tools / ES modules):
 *   window.quizData = { title, subtitle, questionsPerQuiz, questions, results, fullReport }
 *
 * Scoring:
 *   Every option has a `result` field holding a result id
 *   ('strategist' | 'explorer' | 'competitor' | 'casual').
 *   Picking an option adds 1 point to that result. Highest score wins;
 *   on a tie, the result that reached the top score first wins.
 *
 * Trait bars on the result page:
 *   Each result has 4 `traits` (bar labels). traits[i] is driven by the score
 *   of results[i] — i.e. the bars are always, in order:
 *   [strategy, exploring, competing, chilling], just named in that result's voice.
 *
 * To add a question: append to `questions` with a new unique `id`
 *   (4 options, one for each result id).
 * To add a result type: add an entry to `results` (and a 5th trait everywhere),
 *   a matching key in `fullReport`, and tag some options with the new id.
 * ========================================================= */

(function () {
  'use strict';

  var quizData = {
    title: 'What Kind of Gamer Are You?',
    subtitle: '10 quick questions. Zero judgment. One brutally accurate gamer label.',

    // How many questions one quiz run draws from the bank below
    questionsPerQuiz: 10,

    /* ---------------- Question bank ----------------
     * Each run draws `questionsPerQuiz` random questions from this bank,
     * preferring ones the player hasn't seen yet, and shuffles option order.
     *
     * id        unique, stable key (used to remember which questions were seen)
     * text      question shown on screen
     * options   exactly 4 answers: { text, result } — one per result type,
     *           so any random subset of questions stays fair for every result
     * ----------------------------------------------- */
    questions: [
      {
        id: 'q1',
        text: "It's Friday night. What's the plan?",
        options: [
          { text: "Finally finishing that open-world game I started three years ago", result: 'explorer' },
          { text: "Ranked. I'm not sleeping until I hit Diamond", result: 'competitor' },
          { text: 'Theorycrafting builds until my notes look like a conspiracy board', result: 'strategist' },
          { text: 'Couch, snacks, and a cozy game on my phone', result: 'casual' }
        ]
      },
      {
        id: 'q2',
        text: 'You just installed a new game. First thing you do?',
        options: [
          { text: 'Spend 40 minutes in character creation. Looks matter', result: 'casual' },
          { text: 'Read every tutorial tip. Every. Single. One.', result: 'strategist' },
          { text: 'Skip the tutorial and run straight for the edge of the map', result: 'explorer' },
          { text: "Check who's #1 on the leaderboard", result: 'competitor' }
        ]
      },
      {
        id: 'q3',
        text: 'Your teammate is playing like it’s their first day. You…',
        options: [
          { text: "Hop on my main and carry. We're winning this", result: 'competitor' },
          { text: 'Laugh it off. Honestly, this is the best part', result: 'casual' },
          { text: 'Calmly explain where they should have rotated (for ten minutes)', result: 'strategist' },
          { text: 'Huh? Sorry, I was looking at the sunset', result: 'explorer' }
        ]
      },
      {
        id: 'q4',
        text: 'Pick a superpower:',
        options: [
          { text: 'Fast travel anywhere, anytime', result: 'explorer' },
          { text: "Read your opponent's next three moves", result: 'strategist' },
          { text: 'A pause button for real life', result: 'casual' },
          { text: 'Never losing. Ever.', result: 'competitor' }
        ]
      },
      {
        id: 'q5',
        text: 'Your ideal game soundtrack?',
        options: [
          { text: 'Something calm. I need to think', result: 'strategist' },
          { text: 'Boss-fight drums that make my heart pound', result: 'competitor' },
          { text: 'Lo-fi beats to farm turnips to', result: 'casual' },
          { text: 'A sweeping orchestra worthy of an epic journey', result: 'explorer' }
        ]
      },
      {
        id: 'q6',
        text: 'You just lost three games in a row. Your reaction?',
        options: [
          { text: 'Lost? Sure. But I found a secret chest', result: 'explorer' },
          { text: "Losses are data. Let's watch the replay", result: 'strategist' },
          { text: 'Queue again. Not stopping until I win', result: 'competitor' },
          { text: "Whatever, my snack's still good", result: 'casual' }
        ]
      },
      {
        id: 'q7',
        text: "You're stranded on an island with one game genre. Which one?",
        options: [
          { text: "MOBAs, battle royales, fighters — anything with a PvP button", result: 'competitor' },
          { text: 'Turn-based strategy. Chess if I have to', result: 'strategist' },
          { text: 'Farming sims and match-3', result: 'casual' },
          { text: 'A massive open-world adventure', result: 'explorer' }
        ]
      },
      {
        id: 'q8',
        text: 'What does your inventory look like?',
        options: [
          { text: 'Sorted by type, rarity and color', result: 'strategist' },
          { text: 'Full of junk that "might be useful later"', result: 'explorer' },
          { text: 'Inventory? I just click stuff', result: 'casual' },
          { text: 'Only meta gear. Everything else gets sold', result: 'competitor' }
        ]
      },
      {
        id: 'q9',
        text: 'A friend asks for a game recommendation. You send…',
        options: [
          { text: '"Forget recommendations. 1v1 me"', result: 'competitor' },
          { text: 'An obscure indie gem: "Trust me on this one"', result: 'explorer' },
          { text: 'A three-paragraph essay with a tier list', result: 'strategist' },
          { text: '"Whatever\'s free on your phone, honestly"', result: 'casual' }
        ]
      },
      {
        id: 'q10',
        text: 'Be honest: why do you play games?',
        options: [
          { text: 'To unwind and forget about my inbox', result: 'casual' },
          { text: 'To win. Next question.', result: 'competitor' },
          { text: "To see what's behind the next mountain", result: 'explorer' },
          { text: 'To figure out the system and outsmart it', result: 'strategist' }
        ]
      },
      {
        id: 'q11',
        text: 'A gacha game drops a new character. You…',
        options: [
          { text: "Check the tier list first. Only pull if it's worth it", result: 'strategist' },
          { text: 'Pull because they’re cute. Stats are a social construct', result: 'casual' },
          { text: 'Max them out, or I fall behind', result: 'competitor' },
          { text: "Eh, maybe later — there's a new region to explore", result: 'explorer' }
        ]
      },
      {
        id: 'q12',
        text: "You're stuck on a puzzle you just can't crack. You…",
        options: [
          { text: 'Wander off — maybe the clue is somewhere else', result: 'explorer' },
          { text: 'Look up the solution. I have progress to make', result: 'competitor' },
          { text: 'Grab a pen and paper and solve it myself', result: 'strategist' },
          { text: 'Stuck? Guess that’s it for today', result: 'casual' }
        ]
      },
      {
        id: 'q13',
        text: 'Your gamertag is most likely…',
        options: [
          { text: 'Something like "xX_Unbeatable_Xx"', result: 'competitor' },
          { text: "My cat's name", result: 'casual' },
          { text: 'Something like "Wandering Traveler"', result: 'explorer' },
          { text: 'A cryptic abbreviation only I understand', result: 'strategist' }
        ]
      },
      {
        id: 'q14',
        text: 'After the Steam Summer Sale, your library has…',
        options: [
          { text: "20 new games I'll never open", result: 'explorer' },
          { text: 'A few carefully researched, best-value picks', result: 'strategist' },
          { text: 'A new skin so I look cooler when I win', result: 'competitor' },
          { text: "One cozy game that'll last me all year", result: 'casual' }
        ]
      },
      {
        id: 'q15',
        text: 'In an MMO, you spend most of your time…',
        options: [
          { text: 'Fishing in town and watching people dance', result: 'casual' },
          { text: 'Optimizing class combos and rotations', result: 'strategist' },
          { text: 'Visiting every corner of the map', result: 'explorer' },
          { text: 'Raids, leaderboards and PvP', result: 'competitor' }
        ]
      },
      {
        id: 'q16',
        text: 'Your favorite kind of gaming stream?',
        options: [
          { text: 'Pro tournaments — I study the plays', result: 'competitor' },
          { text: 'Just chatting. The game is background noise', result: 'casual' },
          { text: 'Speedruns. Watching people break the rules is art', result: 'strategist' },
          { text: 'Blind playthroughs, hunting for easter eggs together', result: 'explorer' }
        ]
      },
      {
        id: 'q17',
        text: "You've got one save slot left. You…",
        options: [
          { text: 'Save somewhere with a gorgeous view', result: 'explorer' },
          { text: 'Overwrite it. No regrets, full send', result: 'competitor' },
          { text: 'Saving? Autosave has my back', result: 'casual' },
          { text: 'Plan the next few hours of route first, then save', result: 'strategist' }
        ]
      },
      {
        id: 'q18',
        text: 'Your ideal weekend gaming session?',
        options: [
          { text: 'A few quick rounds on the bus', result: 'casual' },
          { text: 'Two or three hours — one full strategy campaign turn', result: 'strategist' },
          { text: 'An all-nighter grinding to the next rank', result: 'competitor' },
          { text: 'A whole day of wandering an open world', result: 'explorer' }
        ]
      },
      {
        id: 'q19',
        text: 'When your friends squad up, you are…',
        options: [
          { text: 'The carry. Every kill is mine', result: 'competitor' },
          { text: 'The one scouting for loot', result: 'explorer' },
          { text: 'The one keeping the vibes up with jokes', result: 'casual' },
          { text: 'The shotcaller telling everyone what to do', result: 'strategist' }
        ]
      },
      {
        id: 'q20',
        text: 'Your favorite type of NPC?',
        options: [
          { text: 'The wise sage with a riddle for you', result: 'strategist' },
          { text: 'The mysterious stranger with a secret quest', result: 'explorer' },
          { text: 'The dog you can pet', result: 'casual' },
          { text: 'The merchant selling the best gear', result: 'competitor' }
        ]
      },
      {
        id: 'q21',
        text: 'How many games are on your phone?',
        options: [
          { text: 'A carefully curated few, each with a purpose', result: 'strategist' },
          { text: 'All puzzle and merge games', result: 'casual' },
          { text: 'Exactly one: my main competitive game', result: 'competitor' },
          { text: "Dozens. I've tried them all, finished almost none", result: 'explorer' }
        ]
      },
      {
        id: 'q22',
        text: 'The same boss has beaten you ten times. You…',
        options: [
          { text: 'Switch to easy mode', result: 'casual' },
          { text: 'Learn the attack patterns. Attempt eleven is the one', result: 'strategist' },
          { text: 'Go level up somewhere else and sightsee on the way', result: 'explorer' },
          { text: 'Keep going until I win. It’s personal now', result: 'competitor' }
        ]
      },
      {
        id: 'q23',
        text: 'How do you feel about achievements?',
        options: [
          { text: 'Hidden ones are the best — surprise unlocks!', result: 'explorer' },
          { text: '100% completion is the bare minimum', result: 'competitor' },
          { text: 'I only care about the ones that take brains', result: 'strategist' },
          { text: 'Nice if I get them, fine if I don’t', result: 'casual' }
        ]
      },
      {
        id: 'q24',
        text: 'A big patch just dropped. First thing you do?',
        options: [
          { text: 'Find the new meta and climb', result: 'competitor' },
          { text: 'Read the full patch notes, line by line', result: 'strategist' },
          { text: 'Rush to the new map', result: 'explorer' },
          { text: 'Claim the free login rewards and log off', result: 'casual' }
        ]
      },
      {
        id: 'q25',
        text: "What's your biggest gaming pet peeve?",
        options: [
          { text: "Invisible walls. I can SEE it, let me go there", result: 'explorer' },
          { text: 'Daily login chores', result: 'casual' },
          { text: 'Deranking', result: 'competitor' },
          { text: 'Mindless grinding', result: 'strategist' }
        ]
      },
      {
        id: 'q26',
        text: 'Your favorite kind of ending?',
        options: [
          { text: 'Happy ending, everyone wins', result: 'casual' },
          { text: 'Multiple endings where every choice matters', result: 'strategist' },
          { text: 'An open ending — the world goes on', result: 'explorer' },
          { text: 'A victory screen with "MVP" next to my name', result: 'competitor' }
        ]
      },
      {
        id: 'q27',
        text: "What's next to you while you play?",
        options: [
          { text: 'A wiki tab and a calculator', result: 'strategist' },
          { text: 'Gaming mouse, headset, 240Hz monitor', result: 'competitor' },
          { text: 'Snacks, a drink and a cat', result: 'casual' },
          { text: 'A hand-drawn map', result: 'explorer' }
        ]
      },
      {
        id: 'q28',
        text: 'If you could live in a game world, which one?',
        options: [
          { text: 'An arena where I can duel every day', result: 'competitor' },
          { text: 'A cozy village with crops and chickens', result: 'casual' },
          { text: 'A fantasy continent with endless places to explore', result: 'explorer' },
          { text: 'A kingdom at war where I rule from the throne', result: 'strategist' }
        ]
      },
      {
        id: 'q29',
        text: 'The thing you say most while gaming?',
        options: [
          { text: '"Wait, what\'s over there?"', result: 'explorer' },
          { text: '"Hold on, let me think"', result: 'strategist' },
          { text: '"Aww, so cute"', result: 'casual' },
          { text: '"One more game!"', result: 'competitor' }
        ]
      },
      {
        id: 'q30',
        text: 'Bring one game item into real life:',
        options: [
          { text: 'A bed that restores full HP', result: 'casual' },
          { text: 'A ring with permanent +50 attack', result: 'competitor' },
          { text: 'A replay system for every decision', result: 'strategist' },
          { text: 'A minimap that shows everything', result: 'explorer' }
        ]
      }
    ],

    /* ---------------- Results ----------------
     * id           used in scoring, URLs (?result=id) and localStorage
     * title        shown as "You are {title}"
     * tagline      one punchy line for the share image
     * description  2–3 casual sentences
     * emoji        big icon on the result page and share image
     * color        theme color (result page accents + share image gradient)
     * traits       4 bar labels, aligned with results[0..3] (see header comment)
     * ----------------------------------------- */
    results: [
      {
        id: 'strategist',
        title: 'The Strategist',
        emoji: '🧠',
        color: '#4D7CFE',
        tagline: "Others play the game. I solve it.",
        description: "Other people play games. You solve them. While your team is still button-mashing, you've already planned three moves ahead — plus a backup plan for the backup plan. Honestly a little scary, but mostly impressive.",
        traits: ['Brainpower', 'Curiosity', 'Drive', 'Chill']
      },
      {
        id: 'explorer',
        title: 'The Explorer',
        emoji: '🧭',
        color: '#2EAD6B',
        tagline: "Main quest? Later. First, that mountain.",
        description: "Main quest? Never heard of her. You play for hidden areas, weird NPCs and the view from the top of the mountain. 100 hours in, you still haven't fought the first boss — and you're having more fun than anyone.",
        traits: ['Planning', 'Wanderlust', 'Grit', 'Go-with-the-flow']
      },
      {
        id: 'competitor',
        title: 'The Competitor',
        emoji: '🏆',
        color: '#E85A4F',
        tagline: 'Second place is just the first loser.',
        description: "Second place is just the first loser, and you know it. You live for clutch plays, leaderboards and that sweet \"VICTORY\" screen. Your teammates love you. Your opponents… not so much.",
        traits: ['Game sense', 'Daring', 'Killer instinct', 'Composure']
      },
      {
        id: 'casual',
        title: 'The Casual',
        emoji: '🛋️',
        color: '#F2A93B',
        tagline: 'Games are my happy place, not a second job.',
        description: "Games are your happy place, not a second job. Cute characters, cozy vibes, zero pressure — and a bag of chips. Honestly? You might be the one who's actually winning at life.",
        traits: ['Smarts', 'Curiosity', 'Competitiveness', 'Good vibes']
      }
    ],

    /* ---------------- Full report ----------------
     * 3 extra short paragraphs per result, revealed after a rewarded ad.
     * Keyed by result id.
     * --------------------------------------------- */
    fullReport: {
      strategist: [
        'Your superpower: patience. You happily lose three games to learn a mechanic, then win the next ten. Deckbuilders, tactics games and anything with a skill tree are basically your home turf.',
        "Your weakness: overthinking. Sometimes the \"optimal play\" is just to move. Try a game with a timer now and then — a little chaos is good for you.",
        'Play next: Slay the Spire, Into the Breach, the Civilization series, or any game with a three-hour guide on YouTube.'
      ],
      explorer: [
        "Your superpower: curiosity. You find the easter eggs the devs hid — and the details they didn't even know were there. Every game world feels like a real place to you.",
        'Your weakness: finishing things. Your backlog has its own backlog. But hey, the journey is the destination.',
        'Play next: The Legend of Zelda: Breath of the Wild, Outer Wilds, Subnautica, Hollow Knight, or any game whose map is covered in question marks.'
      ],
      competitor: [
        "Your superpower: being clutch. The more pressure there is, the clearer you think — because you've already drilled the boring fundamentals to death.",
        'Your weakness: tilting. One bad loss can snowball into five. Drink some water, take a breath, and remember games are supposed to be fun (yes, even ranked).',
        'Play next: League of Legends, Valorant, Rocket League, Street Fighter 6, or any game with a rank next to your name.'
      ],
      casual: [
        "Your superpower: knowing when to stop. You play for joy, not for the grind, so gaming recharges you instead of draining you.",
        "Your weakness: \"just one more day\" in cozy games. Careful — farming sims can steal an entire weekend.",
        "Play next: Stardew Valley, Animal Crossing: New Horizons, Unpacking, A Short Hike, or any game where you can pet the cat."
      ]
    }
  };

  window.quizData = quizData;
})();
