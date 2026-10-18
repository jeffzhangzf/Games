# Mini Games

A collection of free browser mini games for English-speaking players. Pure static front end (no npm, no build tools), monetized with ads, hosted on GitHub Pages.

> Each game has its own section below. Note: many code comments in the older files (`shared/`, `merge/`, `erdayi/`, `idle/`) are still in Chinese; everything players see is in English.

## Project structure

```
├── index.html          # Home page — game cards
├── merge/              # Number Merge
│   ├── index.html
│   └── game.js
├── erdayi/             # Two Beat One (board game vs AI)
│   ├── index.html
│   ├── ai.js           # Rules + AI (pure logic)
│   └── game.js         # Board rendering, turn flow, modals
├── balloon/            # Balloon Pop (Phaser 3, 60-second rounds)
│   ├── index.html
│   └── game.js
├── quiz/               # Gamer Personality Quiz
│   ├── index.html
│   ├── quiz.js         # Views, scoring, result page, sharing
│   └── data.js         # Questions and result copy (edit content here only)
├── idle/               # Idle Farm
│   ├── index.html
│   ├── idle.js         # Game logic
│   └── data.js         # Crop / animal / upgrade numbers (balance here only)
├── shared/
│   ├── ads.js          # Ad manager
│   ├── analytics.js    # Event tracking
│   ├── sound.js        # Sound effects (Web Audio synth, no audio files)
│   └── style.css       # Shared styles
└── README.md
```

## Local preview

```bash
# Start the server in the site root (this folder), otherwise ../shared/ files won't load
python -m http.server 8000
# Open http://localhost:8000
# On a phone: same Wi-Fi as your computer, open http://<your computer's LAN IP>:8000
```

## Ads master switch

`ADS_ENABLED` at the top of `shared/ads.js`:

- `false` (current): no ads anywhere. The banner is hidden and takes no space, interstitials are skipped,
  and "watch ad" buttons (revive, undo, 2× offline earnings, double score) are hidden via the `data-noad-hide` attribute.
  The quiz's "Unlock Full Report" opens the report directly.
- `true`: all ad placements come back.

## Deploying (GitHub Pages)

Static files only — no build step. Push the whole folder to GitHub.

1. **Create a repo**: a new public GitHub repository (e.g. `games`).
2. **Push the code** (run in this folder):
   ```bash
   git init
   git add .
   git commit -m "first release"
   git branch -M main
   git remote add origin https://github.com/<username>/games.git
   git push -u origin main
   ```
3. **Turn on Pages**: repo → Settings → Pages → Source: *Deploy from a branch*,
   Branch `main`, folder `/ (root)` → Save. After 1–2 minutes the site is live at
   `https://<username>.github.io/games/`.
4. From then on, `git add . && git commit -m "..." && git push` republishes automatically.

### Pre-launch checklist

- [ ] `plan.md` is a development spec and would be published too — move it out or add it to `.gitignore` if you don't want it public.
- [ ] Replace `og:url` / `og:image` in every game's `index.html` (search for `TODO`) with real URLs, and add a 1200×630 preview image to each folder.
- [ ] Set `DEBUG` to `false` in `shared/analytics.js` (stops printing events to the console).
- [ ] Test on real phones (iOS Safari + Android Chrome): saving the quiz share image, the native share sheet, rotating the device.
- [ ] Optional custom domain: Settings → Pages → Custom domain, then add the CNAME record at your domain registrar.

### Cache busting after edits

Pages load scripts with a version number (e.g. `../shared/sound.js?v=6`). After editing a JS/CSS file,
bump the `?v=` number in **every page that references it**, or players' browsers may keep using the old cached file.

## Adding GA4 analytics

All events go through `trackEvent()` in `shared/analytics.js`, so no game code needs to change.

1. GA admin → Data streams → add a *Web* stream and copy the Measurement ID (`G-XXXXXXXXXX`).
2. Add the GA snippet to the `<head>` of **every page** (home + 5 games):
   ```html
   <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
   <script>
     window.dataLayer = window.dataLayer || [];
     function gtag(){ dataLayer.push(arguments); }
     gtag('js', new Date());
     gtag('config', 'G-XXXXXXXXXX');
   </script>
   ```
3. In `shared/analytics.js`, uncomment the `window.gtag('event', name, params)` block under the TODO in `trackEvent`.
4. Verify: GA → Reports → Realtime, play a round, and `game_start` etc. should appear within seconds.
   To filter reports by parameters (`score`, `result_type`, …), register them under Admin → Custom definitions.

## Adding real ads

Every ad call goes through three functions in `shared/ads.js`, so no game code needs to change:

| Function | Used for |
|---|---|
| `showInterstitial(cb)` | Number Merge / Two Beat One "play again", after a Balloon Pop round, after quiz question 5 (built-in cap: at most 1 in every 2 calls) |
| `showRewarded(onReward, onCancel)` | Number Merge revive, Two Beat One undo, Balloon Pop double score, Idle Farm 2× offline earnings, quiz full report |
| `showBanner('ad-banner')` | Bottom banner on each page |

Steps (example: Google AdSense + H5 Games Ads; you need an approved AdSense account first):

1. **Add the SDK** to every page's `<head>` (replace `ca-pub-XXXX` with your publisher ID):
   ```html
   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXX"
           data-ad-frequency-hint="120s" crossorigin="anonymous"></script>
   <script>
     window.adsbygoogle = window.adsbygoogle || [];
     var adBreak = adConfig = function (o) { adsbygoogle.push(o); };
     adConfig({ preloadAdBreaks: 'on', sound: 'on' });
   </script>
   ```
   While testing, add `data-adbreak-test="on"` to the `adsbygoogle.js` script tag to get test ads.
2. **Edit `shared/ads.js`**: each of the three functions has a TODO comment with example code;
   replace the mock implementation below it with the `adBreak({...})` call. Call `Sound.suspend()` in
   `beforeAd` / `beforeReward` and `Sound.resume()` in `afterAd`, so game sounds don't play over the ad.
   The SDK has its own frequency capping; you can keep or remove `INTERSTITIAL_EVERY_N_GAMES`.
3. **Banner**: create a display ad unit in AdSense and swap the placeholder in `showBanner` for an `<ins class="adsbygoogle">` (see the comment there).
4. **Flip the switch**: set `ADS_ENABLED` to `true`. Hidden "watch ad" buttons reappear automatically.
5. **ads.txt**: AdSense asks for an `ads.txt` at the domain root. A GitHub Pages project site
   (`username.github.io/games/`) isn't the domain root, so you'll need a custom domain first.

## Number Merge (merge/)

Tap to drop number balls; matching numbers collide and merge into double (1 → 2 → 4 → …). The game ends if a ball stays above the danger line too long.
Phaser 3 + Matter.js physics, both from a CDN.

### Difficulty

| Difficulty | Drop timer | Over-the-line limit | Notes |
|---|---|---|---|
| Easy | none | 2 s | Smallest balls, big numbers unlock slowly |
| Normal | 5 s | 2 s | |
| Hard | 3 s | 1.5 s | Starts dropping 16s right away |
| Insane | 2 s | 1 s | Starts dropping 32s right away |

Each difficulty keeps its own best score. Score = sum of every number you merge.

### Tuning

All at the top of `merge/game.js`:

- `CONFIG`: ball growth `RADIUS_GROWTH`, drop cooldown `DROP_COOLDOWN`, gravity `GRAVITY`,
  ball physics `BALL_PHYSICS`, combo window `COMBO_WINDOW`, screen-shake threshold `SHAKE_FROM`, etc.
- `DIFFICULTIES`: per-difficulty ball size `baseRadius`, drop numbers and weights `spawn` (`unlockAt` = how big you must merge before it starts dropping),
  drop timer `autoDrop`, over-the-line limit `gameOverDelay`. Add an entry here and it shows up in the difficulty picker automatically.
- `COLORS`: color of each number.

### localStorage

| Key | Contents |
|---|---|
| `merge_best_score_<difficulty>` | Best score per difficulty (`easy` / `normal` / `hard` / `hell`) |
| `merge_difficulty` | Last chosen difficulty |
| `merge_tutorial_seen` | First-time tutorial seen (`"1"`) |
| `sound_muted` | Site-wide mute setting (shared by all games) |

### Events

`game_start` (difficulty), `game_end` (difficulty / score), `merge` (value), `revive_used` (only with ads on).

## Two Beat One (erdayi/)

A classic folk strategy board game (Chinese *Er Da Yi*, "two hit one"), played against the AI. Pure DOM + SVG, no game engine.

### Rules

- Each side starts on its back line; the player (orange) moves first. Each turn, move one piece one step along a line to an empty neighbor — no diagonals, no jumping.
- After your move, if a row or column has **two of your pieces side by side, right next to one enemy piece**, **and no other pieces on that line**, the enemy piece is captured.
- It doesn't count if the enemy walks into that spot. You win when the opponent has 1 piece left or can't move; 60 moves in a row (both sides) without a capture is a draw.

### Difficulty

- Board: 4×4 (classic) / 5×5 / 6×6; pieces per side = number of lines. Configured in `BOARD_SIZES` in `erdayi/game.js`.
- AI: Easy / Normal / Hard, configured in `LEVELS` in `erdayi/game.js`:
  `randomRate` (chance of a random move), `depth` (max search depth), `timeLimit` (ms per move).
- Rules and AI (negamax + alpha-beta + iterative deepening) live in `erdayi/ai.js`, pure logic with no DOM, testable in Node.
- Other settings (draw limit `DRAW_LIMIT`, undos per game `UNDO_PER_GAME`, …) are in `CONFIG` in `erdayi/game.js`.

### localStorage

| Key | Contents |
|---|---|
| `erdayi_settings` | Last chosen board and difficulty |
| `erdayi_stats_<board>_<difficulty>` | Record (W / L / D), e.g. `erdayi_stats_4_normal` |
| `erdayi_rules_seen` | Rules seen (shown automatically on first visit) |
| `erdayi_hint_seen` | First-game move hint seen |
| `sound_muted` | Site-wide mute setting (shared by all games) |

### Events

`game_start` (size / level), `game_end` (size / level / result / moves), `undo_used` (only with ads on).

## Balloon Pop (balloon/)

60-second rounds: tap balloons rising from the stall to pop them. Phaser 3 from a CDN (no physics engine).

### Gameplay

| Balloon | Points | Notes |
|---|---|---|
| Regular (red/blue/green/yellow/purple) | +10 | |
| Gold | +50 | 8% spawn chance, flies faster |
| Black bomb | -20 | 10% spawn chance, 18% in the last 20 seconds; score never drops below 0 |

30 shots per clip with an automatic 0.5 s reload when empty (unlimited ammo); misses don't cost points.

### Tuning

All at the top of `balloon/game.js`:

- `CONFIG`: round length `ROUND_TIME`, clip size `MAG_SIZE`, reload time `RELOAD_MS`,
  points per balloon `SCORE`, gold speed-up `GOLD_SPEED_MULT`, hitbox padding `HIT_PADDING`,
  tap filter `MIN_TAP_GAP`, etc.
- `PHASES`: three difficulty phases, each with
  `until` (ends at second N), `speed` (rise speed range), `radius` (balloon size),
  `spawnEvery` (ms between spawns), `goldRate` / `bombRate`, and
  `banner` (text shown when the phase starts).

Speeds and sizes are in units of a 400-px-wide design and scale with screen width.

### localStorage

| Key | Contents |
|---|---|
| `balloon_best` | Best score |
| `balloon_tutorial_seen` | First-time tutorial seen (`"1"`) |
| `sound_muted` | Site-wide mute setting (shared by all games) |

### Events

`game_start`, `game_end` (score / accuracy / ignored_taps), `balloon_hit` (type: normal / gold / bomb),
`reload`, `rewarded_unlocked` (type: double_score, only with ads on).

## Gamer Personality Quiz (quiz/)

10 questions that reveal your gamer type: 🧠 The Strategist / 🧭 The Explorer / 🏆 The Competitor / 🛋️ The Casual.
Plain HTML + CSS + vanilla JS, a single page switching between three views (start / question / result), no external libraries.

### Flow

- Each run draws 10 questions from a 30-question bank, preferring unseen ones (no repeats in the first 3 runs), and shuffles option order.
- Each option belongs to one result; picking it adds 1 point. Highest score wins; ties go to the result that reached the top score first.
- Result page: trait bars, sharing (native share sheet / save share image / copy link), and the full report (rewarded ad, unlocked once per result).
- An interstitial runs after question 5 (question 6 renders first; frequency capping is handled by `shared/ads.js`).
- After finishing, the URL becomes `?result=<result id>`. Sending that link shows the result directly and invites the friend to take the quiz;
  invalid values (e.g. `?result=xxx`) fall back to the start page.

### Editing content (only `quiz/data.js`)

- **Add a question**: add an entry to `questions` with a unique `id` that never changes (it's used to remember seen questions);
  exactly 4 `options`, one for each result id (so random draws stay fair to every result).
- **Questions per run**: `questionsPerQuiz`.
- **Result copy**: each entry in `results` has `title`, `tagline` (share image line), `description` (2–3 sentences),
  `emoji`, `color` (accent color + share image gradient) and `traits` (4 bar labels — bar i is driven by
  the score of `results[i]`, just named in that result's voice). The full report is `fullReport[result id]`, 3 paragraphs.
- **Add a result type**: ① add an entry to `results` (new `id`); ② give every result 5 `traits`;
  ③ add the matching key to `fullReport`; ④ add an option pointing to the new id in every question (options per question = number of results).
  No logic changes needed.

Other settings (advance delay, which question triggers the interstitial, trait bar range, …) are in `CONFIG` at the top of `quiz/quiz.js`.

### localStorage

| Key | Contents |
|---|---|
| `quiz_last_result` | Most recent result id (start page shows "Last time you got…") |
| `quiz_completions` | Number of finished quizzes (3+ gets a different welcome line) |
| `quiz_seen_questions` | Question ids already shown in the current rotation |
| `quiz_unlocked_reports` | Result ids whose full report is unlocked |
| `sound_muted` | Site-wide mute setting (shared by all games) |

### Events

`quiz_start`, `quiz_answer` (question_index / question_id), `quiz_complete` (result_type),
`share_clicked` (platform: native / image / copy, result_type), `rewarded_unlocked` (result_type).

### Share previews

X, Facebook, Discord, iMessage etc. read the `og:*` tags in `quiz/index.html`. After launch, fill in
`og:url` and `og:image` (a generic 1200×630 image) with real URLs. Crawlers don't run JS, so per-result
preview images would need a static page per result or server support — see the comment in `index.html`.

## Idle Farm (idle/)

An idle farming game: plant crops, raise animals, buy upgrades — the farm keeps earning after you close the page. Pure DOM + CSS, no game engine.

### Gameplay

- Tap an empty plot to plant; tap ripe crops to harvest and sell. Wheat seeds are free, so you can never get stuck.
- Animals take up a plot and produce on a timer (🥚🥛🧶🍯), pausing at 3 items until you collect. You can sell an animal for half its price.
- 7 crops (Wheat → Sunflower) and 4 animals (Chicken → Bee) unlock in order; later ones earn more per plot but grow slower and cost more to unlock.
- 5 upgrades: Fertilizer (faster growth), Farmers Market (crops sell for more), Premium Feed (animals produce more),
  Expand Farm (+2 plots, up to 20), Hire a Farmhand (higher offline rate).
- Offline earnings: away for more than 60 s → on return you get time away (max 8 h) × income per second × offline rate (20% to start),
  shown in a "Welcome back!" popup. With ads on, a rewarded video doubles it (the button is hidden while ads are off).
- New players get a 3-step tutorial: plant wheat → harvest → what to do next.

### Tuning (only `idle/data.js`)

- Globals: starting coins `START_COINS`, starting plots `START_PLOTS`, plot cap `MAX_PLOTS`,
  offline earnings `OFFLINE_BASE_RATE` / `OFFLINE_MIN_SECONDS` / `OFFLINE_MAX_HOURS`,
  animal stock cap `ANIMAL_MAX_STOCK`, animal sell refund `ANIMAL_SELL_REFUND`.
- `crops`: `growTime` (s), `seedCost`, `sellPrice`, `unlockCost` (0 = available from the start).
  To add a crop, add a line; keep `id` unique and never change it after launch (it's in save files).
- `animals`: `produceTime`, `produceValue`, `unlockCost`, `buyCost`, `product` (product emoji).
- `upgrades`: price = `baseCost` × `costMultiplier`^(level − 1), `maxLevel`,
  `effect.type` must be one of `growSpeed` / `cropValue` / `animalValue` / `plots` / `offlineRate`.

If the save format changes, bump `CONFIG.SAVE_VERSION` in `idle/idle.js` and migrate in `loadState`;
crops/animals removed from the config are cleared from plots automatically on load.
Debugging in the browser console: `IdleGame.state.coins = 1e6; IdleGame.refresh()` to set coins, `IdleGame.reset()` to wipe the save.

### localStorage

| Key | Contents |
|---|---|
| `idle_farm_save` | Save data (coins, plots, unlocks, upgrade levels, last seen); saved every 5 s, when hidden and on page close |
| `idle_tutorial_seen` | Tutorial seen (`"1"`; players with an existing save are marked as seen) |
| `sound_muted` | Site-wide mute setting (shared by all games) |

### Events

`idle_start` (first visit), `crop_planted` (crop_id), `crop_harvested` (crop_id / value),
`animal_collected` (animal_id / value), `upgrade_purchased` (upgrade_id),
`offline_earnings_claimed` (amount / multiplier).
