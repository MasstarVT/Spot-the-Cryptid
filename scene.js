/* ==========================================================
   scene.js  -  BUILDS, CHECKS AND DRAWS THE FOREST FOR EACH ROUND

   Needs:  sprites.js (PALETTE, SPRITES, CRYPTIDS), loaded before it.
   Shares: one object called Scene:
     Scene.LOGICAL_WIDTH, Scene.LOGICAL_HEIGHT  size of the picture (320x180)
     Scene.generateRound(seed, avoidName)  a new forest with a hidden cryptid
     Scene.auditRound(round)               is this forest safe to show?
     Scene.drawForest(ctx, round)          paint the forest (cryptid hidden)
     Scene.drawReveal(ctx, round)          paint the found cryptid, lit up
     Scene.drawMissMark(ctx, x, y)         paint a small X centred on (x, y)
     Scene.drawRectOutline(ctx, rect, c)   paint a 1-pixel frame
     Scene.rectsOverlap(a, b)              do two rectangles overlap?
     Scene.makeRandom(seed)                seeded random numbers
     Scene.checkData()                     start-up checks of all the art

   HOW A CRYPTID STAYS HIDDEN
   Every round the cryptid hides in exactly the arrangement Step 1 tested
   pixel by pixel: the cryptid, then an oak drawn over it (the leaves hide
   the top of its head, the trunk hides its right side), then a bush drawn
   over its legs. Only the oak's x changes. On top of that:
     1. EVERY back-row oak gets the same bush and stands at the same
        height, so "the oak with a bush" is never a clue. There are
        always several look-alike oaks with nobody behind them.
     2. Other trees are placed beside the hiding spot, never on it.
     3. auditRound() re-checks every finished forest, pixel by pixel,
        before anyone sees it. A forest that fails is rebuilt.

   Why the (function () { ... })() wrapper? Names made inside it are
   private to this file, so a helper here can never clash with a helper
   of the same name in another file. Only what "return" lists is shared.
   ========================================================== */
const Scene = (function () {
  'use strict';

  /* ----------------------------------------------------------
     1. SIZES
     ---------------------------------------------------------- */
  // The game is drawn on a tiny 320x180 "logical" canvas (16:9).
  // The browser scales it up, so 1 logical pixel = 1 chunky square.
  const LOGICAL_WIDTH = 320;
  const LOGICAL_HEIGHT = 180;

  const HORIZON_Y = 104;        // where the ground starts
  const FAR_TREELINE_Y = 82;    // where the far-away treeline starts
  // Top of the solid dark band under the far treeline (y 89-103).
  const FAR_BAND_TOP = FAR_TREELINE_Y + SPRITES.farPine.length;

  /* ----------------------------------------------------------
     2. THE HIDING SPOT
     Offsets copied from Step 1 (oak 196,82 / sasquatch 198,96 /
     bush 195,104), where they were checked pixel by pixel. Change them
     only together with the art.
     ---------------------------------------------------------- */
  const HIDING_SPOT = {
    oakY: 82,       // keep: it puts the peeking part (y 98-103) in front
                    // of the dark far-forest band, where it blends in
    cryptidDX: 2,   // cryptid = oak + (2, 14)
    cryptidDY: 14,
    bushDX: -1,     // bush = oak + (-1, 22)
    bushDY: 22,
  };

  // Every cryptid must be this size: the hiding spot is tuned for it.
  const CRYPTID_WIDTH = 9;
  const CRYPTID_HEIGHT = 15;

  // The ONLY part of a hiding cryptid that may show: sprite columns 0-5
  // of rows 2-7 (the left side of its head and shoulder). Row 8 is
  // covered by the top of the oakBush.
  const PEEK_AREA = { left: 0, right: 5, top: 2, bottom: 7 };
  const MIN_VISIBLE_PIXELS = 6;    // fewer: nobody could ever find it
  const MAX_VISIBLE_PIXELS = 40;   // more: far too easy

  // A guess HITS if its grid cell touches the peek area plus this many
  // pixels. Only the peeking part counts (not the hidden body behind the
  // trunk), so guessing "the trunk of every oak" does not win by itself:
  // you have to spot the eyes.
  const HIT_PADDING = 1;

  // Nothing else in the scene may come this close to ANY part of the
  // cryptid's sprite (Step 1's CLICK_PADDING). This box is also the gold
  // frame drawn around it at the reveal.
  const CLEAR_PADDING = 2;

  // Where the hiding oak may stand. The margins keep the cryptid clear
  // of the grid's row numbers along the left and right edges (x 0-6 and
  // 314-320): its padded box always stays inside x 8..305.
  const HIDING_OAK_MIN_X = 8;
  const HIDING_OAK_MAX_X = 292;
  const MAX_ATTEMPTS = 40;         // after that, use Step 1's forest (always safe)

  // The tell (the eyes) must stand out from the body at least this much
  // (a WCAG contrast ratio: 1 = identical, 21 = black on white). Fainter
  // eyes vanish on a compressed stream. Only a console warning.
  const MIN_TELL_CONTRAST = 2.5;

  /* ----------------------------------------------------------
     3. THE BACK ROW (rebuilt every round)
     Lots of identical oak + bush groups make lots of places to look,
     so chat has to spot the eyes instead of trying every oak.
     ---------------------------------------------------------- */
  const DECOY_SPOTS = 5;           // extra oak + bush groups, always tried first
  const DECOY_TRIES = 40;
  const OAK_CHANCE = 0.6;          // filler trees: 60% oaks, the rest pines
  const PINE_TOP_MIN = 82;
  const PINE_TOP_MAX = 87;
  const TREE_GAP_MIN = 3;          // empty pixels between back-row trees
  const TREE_GAP_MAX = 12;

  // One cloud is placed somewhere inside each of these sky areas.
  const CLOUD_AREAS = [
    { minX: 8,   maxX: 70,  minY: 8, maxY: 34 },
    { minX: 118, maxX: 180, minY: 8, maxY: 34 },
    { minX: 228, maxX: 300, minY: 8, maxY: 34 },
  ];

  /* ----------------------------------------------------------
     4. SCENERY THAT NEVER CHANGES (data, from Step 1)
     Drawn after the back row, so it appears in front of it.
     ---------------------------------------------------------- */
  const FIXED_ROWS = [
    // --- Middle row ---
    { sprite: 'grass', x: 14,  y: 118 },
    { sprite: 'rock',  x: 40,  y: 122 },
    { sprite: 'bush',  x: 70,  y: 124 },
    // Step 1 had this pine at y 112. At 114 it stays clear of every
    // possible hiding spot (their padded boxes end at y 112), so the
    // cryptid can hide behind any oak, including the one near this pine.
    { sprite: 'pine',  x: 100, y: 114 },
    { sprite: 'grass', x: 130, y: 126 },
    { sprite: 'bush',  x: 150, y: 128 },
    { sprite: 'rock',  x: 178, y: 130 },
    { sprite: 'grass', x: 210, y: 120 },
    { sprite: 'pine',  x: 232, y: 116 },
    { sprite: 'bush',  x: 262, y: 126 },
    { sprite: 'grass', x: 290, y: 124 },

    // --- Front row (closest to the viewer, drawn last) ---
    { sprite: 'grass', x: 6,   y: 156 },
    { sprite: 'pine',  x: 20,  y: 146 },
    { sprite: 'rock',  x: 52,  y: 160 },
    { sprite: 'bush',  x: 80,  y: 158 },
    { sprite: 'grass', x: 112, y: 166 },
    { sprite: 'oak',   x: 134, y: 148 },
    { sprite: 'rock',  x: 172, y: 168 },
    { sprite: 'grass', x: 200, y: 160 },
    { sprite: 'bush',  x: 220, y: 164 },
    { sprite: 'pine',  x: 250, y: 152 },
    { sprite: 'grass', x: 284, y: 170 },
    { sprite: 'rock',  x: 300, y: 162 },
  ];
  // Every round shares these objects, so make sure nothing changes them.
  FIXED_ROWS.forEach(Object.freeze);

  // Step 1's forest: the safety net if random forests keep failing, and
  // the test bed for every cryptid at start-up. Its oaks get bushes too,
  // like every back-row oak (pines keep their Step 1 heights).
  const STEP1_HIDING_OAK_X = 196;
  const STEP1_TREES_LEFT = [
    { sprite: 'pine', x: 2,   y: 84 },
    { sprite: 'oak',  x: 26 },
    { sprite: 'pine', x: 58,  y: 86 },
    { sprite: 'pine', x: 90,  y: 82 },
    { sprite: 'oak',  x: 118 },
    { sprite: 'pine', x: 152, y: 84 },
    { sprite: 'pine', x: 176, y: 87 },
  ];
  const STEP1_TREES_RIGHT = [
    { sprite: 'pine', x: 224, y: 85 },
    { sprite: 'pine', x: 254, y: 83 },
    { sprite: 'oak',  x: 280 },
    { sprite: 'pine', x: 306, y: 84 },
  ];
  const STEP1_CLOUDS = [
    { sprite: 'cloud', x: 28,  y: 14 },
    { sprite: 'cloud', x: 150, y: 28 },
    { sprite: 'cloud', x: 252, y: 10 },
  ];

  /* ----------------------------------------------------------
     5. COLOURS AND BACKGROUND BANDS (from Step 1)
     ---------------------------------------------------------- */
  const SKY_BANDS = [
    { top: 0,  height: 40, color: '#6fb3e0' },
    { top: 40, height: 36, color: '#93cbe9' },
    { top: 76, height: 28, color: '#c4e5f0' },   // ends at HORIZON_Y
  ];
  const GROUND_BANDS = [
    { top: 104, height: 12, color: '#3a7030' },  // back row of trees stands here
    { top: 116, height: 20, color: '#437f34' },  // middle row
    { top: 136, height: 44, color: '#4b8c3a' },  // front row
  ];
  const FAR_FOREST = PALETTE.H;                  // solid band under the far treeline
  // How many pixels each far-away pine is nudged down, so the far
  // treeline is uneven instead of a perfect zigzag.
  const FAR_TREE_WOBBLE = [0, 2, 1, 3, 1, 0, 2];
  const HIGHLIGHT = '#ffd84a';                   // box around the found cryptid
  const MISS_COLOR = '#ff5a4a';                  // the X on a missed grid square
  const MISS_SHADOW = 'rgba(0, 0, 0, 0.6)';

  /* ----------------------------------------------------------
     6. SEEDED RANDOM NUMBERS
     Math.random can't be replayed. This tiny generator (mulberry32)
     can: the same seed always gives the same numbers, so the same seed
     always builds the same forest. Great for testing (?seed=42) and for
     reproducing a bug someone saw on stream.
     ---------------------------------------------------------- */
  function makeRandom(seed) {
    let state = seed >>> 0;
    return function random() {   // a number from 0 (included) to 1 (not included)
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A whole number from min to max, both included.
  function randomInt(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
  }

  function pick(random, list) {
    return list[Math.floor(random() * list.length)];
  }

  /* ----------------------------------------------------------
     7. ITEMS AND BOXES
     An item is one thing to draw: { sprite: 'oak', x, y } for scenery,
     or { cryptid: <an entry of CRYPTIDS>, x, y } for the cryptid.
     A box ("rect") is { x, y, width, height } in logical pixels.
     ---------------------------------------------------------- */
  function itemSprite(item) {
    return item.cryptid ? item.cryptid.sprite : SPRITES[item.sprite];
  }

  function itemColors(item) {
    return item.cryptid ? item.cryptid.colors : PALETTE;
  }

  function spriteWidth(sprite) {
    return sprite && sprite.length > 0 ? sprite[0].length : 0;
  }

  function spriteHeight(sprite) {
    return sprite ? sprite.length : 0;
  }

  // An unknown sprite name (a typo) gives an empty box instead of a crash.
  function itemRect(item) {
    const sprite = itemSprite(item);
    return { x: item.x, y: item.y, width: spriteWidth(sprite), height: spriteHeight(sprite) };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.width && b.x < a.x + a.width &&
           a.y < b.y + b.height && b.y < a.y + a.height;
  }

  // A box grown by "padding" pixels on every side.
  function padRect(rect, padding) {
    return {
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    };
  }

  // The left and right edges (x) that a group of items covers.
  function spanOf(items) {
    let left = Infinity;
    let right = -Infinity;
    for (const item of items) {
      const rect = itemRect(item);
      left = Math.min(left, rect.x);
      right = Math.max(right, rect.x + rect.width);
    }
    return { left: left, right: right };
  }

  // The first used span that overlaps "span", or null if it is free.
  function findBlockingSpan(usedSpans, span) {
    for (const used of usedSpans) {
      if (span.left < used.right && used.left < span.right) return used;
    }
    return null;
  }

  /* ----------------------------------------------------------
     8. BUILDING A ROUND
     A round is plain data:
       { seed, cryptid, cryptidX, cryptidY, spriteBox, hitBox, items, attempts }
     "items" is everything to draw, in order (later = in front).
     ---------------------------------------------------------- */
  // An oak with a bush in front of its trunk. EVERY back-row oak looks
  // exactly like this (same height, same bush), so the hiding oak never
  // stands out.
  function makeOakGroup(oakX) {
    return [
      { sprite: 'oak', x: oakX, y: HIDING_SPOT.oakY },
      { sprite: 'oakBush', x: oakX + HIDING_SPOT.bushDX, y: HIDING_SPOT.oakY + HIDING_SPOT.bushDY },
    ];
  }

  // The cryptid, THEN the oak, THEN the bush: this ORDER is what hides it.
  // "hidingSpot: true" marks the only items allowed to overlap it.
  function makeHidingSpot(cryptid, oakX) {
    const cryptidItem = {
      cryptid: cryptid,
      x: oakX + HIDING_SPOT.cryptidDX,
      y: HIDING_SPOT.oakY + HIDING_SPOT.cryptidDY,
    };
    return [cryptidItem].concat(makeOakGroup(oakX)).map(function (item) {
      item.hidingSpot = true;
      return item;
    });
  }

  // One filler tree whose left edge is at leftX.
  function makeFillerTree(random, kind, leftX) {
    if (kind === 'oak') return makeOakGroup(leftX - HIDING_SPOT.bushDX);   // its bush sticks out 1 px to the left
    return [{ sprite: 'pine', x: leftX, y: randomInt(random, PINE_TOP_MIN, PINE_TOP_MAX) }];
  }

  function makeClouds(random) {
    return CLOUD_AREAS.map(function (area) {
      return { sprite: 'cloud', x: randomInt(random, area.minX, area.maxX), y: randomInt(random, area.minY, area.maxY) };
    });
  }

  // The back row: the real hiding spot, then decoys, then filler trees in
  // every gap. Each placed group "uses" its x range plus TREE_GAP_MIN on
  // both sides, and nothing else may go in a used range. So no tree can
  // ever stand in front of (or behind) the cryptid.
  function buildBackRow(random, cryptid) {
    const groups = [];
    const usedSpans = [];
    function addGroup(items) {
      const span = spanOf(items);
      groups.push(items);
      usedSpans.push({ left: span.left - TREE_GAP_MIN, right: span.right + TREE_GAP_MIN });
    }

    // 1. The real hiding spot, anywhere in its allowed range.
    addGroup(makeHidingSpot(cryptid, randomInt(random, HIDING_OAK_MIN_X, HIDING_OAK_MAX_X)));

    // 2. Decoys: identical oak + bush groups with nobody behind them, so
    //    there are always several look-alike spots to check.
    const oakWidth = spriteWidth(SPRITES.oak);
    for (let decoy = 0; decoy < DECOY_SPOTS; decoy++) {
      for (let attempt = 0; attempt < DECOY_TRIES; attempt++) {
        const group = makeOakGroup(randomInt(random, 0, LOGICAL_WIDTH - oakWidth));
        if (!findBlockingSpan(usedSpans, spanOf(group))) {
          addGroup(group);
          break;
        }
      }
    }

    // 3. Filler trees, left to right, jumping over anything already placed.
    let x = randomInt(random, -8, -2);
    while (x < LOGICAL_WIDTH) {
      const kind = random() < OAK_CHANCE ? 'oak' : 'pine';
      const group = makeFillerTree(random, kind, x);
      const blocker = findBlockingSpan(usedSpans, spanOf(group));
      if (blocker) {
        x = blocker.right;   // always moves right, so this loop always ends
        continue;
      }
      addGroup(group);
      x = spanOf(group).right + randomInt(random, TREE_GAP_MIN, TREE_GAP_MAX);
    }

    // Left to right, keeping each group's own draw order.
    groups.sort(function (a, b) { return spanOf(a).left - spanOf(b).left; });
    return [].concat.apply([], groups);
  }

  // Wrap a list of items into a round, with the cryptid's two boxes.
  function makeRound(seed, cryptid, items) {
    const cryptidItem = items.find(function (item) { return item.cryptid; });
    const peekRect = {
      x: cryptidItem.x + PEEK_AREA.left,
      y: cryptidItem.y + PEEK_AREA.top,
      width: PEEK_AREA.right - PEEK_AREA.left + 1,
      height: PEEK_AREA.bottom - PEEK_AREA.top + 1,
    };
    return {
      seed: seed,
      cryptid: cryptid,
      cryptidX: cryptidItem.x,
      cryptidY: cryptidItem.y,
      // The whole sprite plus a margin: no other scenery may touch it,
      // and it is framed in gold at the reveal.
      spriteBox: padRect(itemRect(cryptidItem), CLEAR_PADDING),
      // The part a guess must touch: what viewers can actually see, plus
      // a small margin. The same rule for mouse and chat.
      hitBox: padRect(peekRect, HIT_PADDING),
      items: items,
      attempts: 0,
    };
  }

  function buildRandomRound(seed, random, cryptid) {
    const items = [].concat(makeClouds(random), buildBackRow(random, cryptid), FIXED_ROWS);
    return makeRound(seed, cryptid, items);
  }

  // Step 1's trees, with a bush added to each oak.
  function step1Trees(trees) {
    return [].concat.apply([], trees.map(function (tree) {
      return tree.sprite === 'oak' ? makeOakGroup(tree.x) : [tree];
    }));
  }

  // Step 1's forest, with any cryptid in Step 1's hiding spot.
  function buildStep1Round(cryptid) {
    const items = [].concat(
      STEP1_CLOUDS,
      step1Trees(STEP1_TREES_LEFT),
      makeHidingSpot(cryptid, STEP1_HIDING_OAK_X),
      step1Trees(STEP1_TREES_RIGHT),
      FIXED_ROWS
    );
    return makeRound(0, cryptid, items);
  }

  /* ----------------------------------------------------------
     9. THE SAFETY CHECK ("audit")
     Run on EVERY forest before it is shown. Returns
       { ok, problems: [...], visible: [pixels that peek out] }
     ---------------------------------------------------------- */
  // Does this item paint a pixel at logical (x, y)?
  function isOpaqueAt(item, x, y) {
    const sprite = itemSprite(item);
    if (!sprite) return false;
    const row = y - item.y;
    const col = x - item.x;
    if (row < 0 || row >= sprite.length || col < 0) return false;
    const letter = sprite[row].charAt(col);   // '' past the end of the row
    return Boolean(itemColors(item)[letter]);
  }

  // Every cryptid pixel that NO later item paints over = what viewers see.
  function findVisiblePixels(round) {
    const cryptidIndex = round.items.findIndex(function (item) { return item.cryptid; });
    const cryptidItem = round.items[cryptidIndex];
    const drawnLater = round.items.slice(cryptidIndex + 1);
    const sprite = cryptidItem.cryptid.sprite;
    const visible = [];
    for (let row = 0; row < sprite.length; row++) {
      for (let col = 0; col < sprite[row].length; col++) {
        const letter = sprite[row][col];
        if (!cryptidItem.cryptid.colors[letter]) continue;   // see-through pixel
        const x = cryptidItem.x + col;
        const y = cryptidItem.y + row;
        const covered = drawnLater.some(function (item) { return isOpaqueAt(item, x, y); });
        if (!covered) visible.push({ col: col, row: row, letter: letter });
      }
    }
    return visible;
  }

  function isInPeekArea(pixel) {
    return pixel.col >= PEEK_AREA.left && pixel.col <= PEEK_AREA.right &&
           pixel.row >= PEEK_AREA.top && pixel.row <= PEEK_AREA.bottom;
  }

  function auditRound(round) {
    const problems = [];

    // Rule 1: nothing but its own oak and bush may touch the padded
    // sprite box. (Something in front would cover the peeking part;
    // something behind would put a bright tree behind it instead of the
    // dark forest.)
    for (const item of round.items) {
      if (item.hidingSpot) continue;
      if (rectsOverlap(itemRect(item), round.spriteBox)) {
        problems.push('a ' + item.sprite + ' at ' + item.x + ',' + item.y + ' touches the hiding spot');
      }
    }

    // Rule 2: a fair amount peeks out - findable, but not easy.
    const visible = findVisiblePixels(round);
    if (visible.length < MIN_VISIBLE_PIXELS) {
      problems.push('only ' + visible.length + ' pixels show - nobody could find it');
    }
    if (visible.length > MAX_VISIBLE_PIXELS) {
      problems.push(visible.length + ' pixels show - far too easy');
    }

    // Rule 3: only the peek area beside the trunk may show.
    visible.forEach(function (pixel) {
      if (!isInPeekArea(pixel)) {
        problems.push('sprite column ' + pixel.col + ', row ' + pixel.row + ' pokes out of the hiding spot');
      }
    });

    // Rule 4: its tell (the eyes) can be seen, so the round is winnable.
    const tell = round.cryptid.tell;
    if (!visible.some(function (pixel) { return pixel.letter === tell; })) {
      problems.push('its tell "' + tell + '" is completely hidden');
    }

    // Rule 5: the whole peeking part sits in front of the dark far-forest
    // band (y 89-103), never on the lighter ground that starts at y 104.
    const peekTop = round.cryptidY + PEEK_AREA.top;
    const peekBottom = round.cryptidY + PEEK_AREA.bottom;
    if (peekTop < FAR_BAND_TOP || peekBottom >= HORIZON_Y) {
      problems.push('the peeking part is not in front of the dark far forest (y ' +
        FAR_BAND_TOP + '-' + (HORIZON_Y - 1) + ')');
    }

    return { ok: problems.length === 0, problems: problems, visible: visible };
  }

  /* ----------------------------------------------------------
     10. MAKING A NEW ROUND
     ---------------------------------------------------------- */
  // Starts as every cryptid; checkData() leaves out any that fail.
  let usableCryptids = CRYPTIDS.slice();

  // A random cryptid, but not last round's one (when there is a choice).
  function pickCryptid(random, avoidName) {
    const others = usableCryptids.filter(function (cryptid) { return cryptid.name !== avoidName; });
    return pick(random, others.length > 0 ? others : usableCryptids);
  }

  // A brand-new round from a seed. The same seed (and the same previous
  // cryptid) always gives the same cryptid, hiding spot and trees. A
  // forest that fails the audit is rebuilt with the next random numbers,
  // so the result is still repeatable.
  function generateRound(seed, avoidName) {
    const random = makeRandom(seed);
    const cryptid = pickCryptid(random, avoidName);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const round = buildRandomRound(seed, random, cryptid);
      if (auditRound(round).ok) {
        round.attempts = attempt;
        return round;
      }
    }
    warn('Seed ' + seed + ': no safe random forest, using the Step 1 forest.');
    const fallback = buildStep1Round(cryptid);
    fallback.seed = seed;
    return fallback;
  }

  /* ----------------------------------------------------------
     11. DRAWING
     Every function takes "ctx" (the canvas to paint on), so the same
     code can paint the visible canvas or the hidden forest canvas.
     ---------------------------------------------------------- */
  function fillRect(ctx, x, y, width, height, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  }

  // Each character of the sprite becomes one 1x1 logical pixel.
  // "colors" says which colour each letter is.
  function drawSprite(ctx, sprite, x, y, colors) {
    if (!sprite) return;   // checkData() already warned about the typo
    for (let row = 0; row < sprite.length; row++) {
      const line = sprite[row];
      for (let col = 0; col < line.length; col++) {
        const color = colors[line[col]];
        if (!color) continue;   // '.' (or an unknown letter) draws nothing
        fillRect(ctx, x + col, y + row, 1, 1, color);
      }
    }
  }

  // A 1-pixel-thick rectangle outline.
  function drawRectOutline(ctx, rect, color) {
    fillRect(ctx, rect.x, rect.y, rect.width, 1, color);                    // top
    fillRect(ctx, rect.x, rect.y + rect.height - 1, rect.width, 1, color);  // bottom
    fillRect(ctx, rect.x, rect.y, 1, rect.height, color);                   // left
    fillRect(ctx, rect.x + rect.width - 1, rect.y, 1, rect.height, color);  // right
  }

  function drawBands(ctx, bands) {
    for (const band of bands) {
      fillRect(ctx, 0, band.top, LOGICAL_WIDTH, band.height, band.color);
    }
  }

  // A row of tiny pines along the horizon, standing on a solid dark band.
  function drawFarTreeline(ctx) {
    const spacing = 6;   // 6 apart with a 7-wide sprite = no gaps
    const count = Math.ceil(LOGICAL_WIDTH / spacing) + 1;
    for (let i = 0; i < count; i++) {
      const wobble = FAR_TREE_WOBBLE[i % FAR_TREE_WOBBLE.length];
      drawSprite(ctx, SPRITES.farPine, i * spacing - 3, FAR_TREELINE_Y + wobble, PALETTE);
    }
    fillRect(ctx, 0, FAR_BAND_TOP, LOGICAL_WIDTH, HORIZON_Y - FAR_BAND_TOP, FAR_FOREST);
  }

  // The whole forest, cryptid still hidden.
  function drawForest(ctx, round) {
    drawBands(ctx, SKY_BANDS);
    drawFarTreeline(ctx);
    drawBands(ctx, GROUND_BANDS);
    for (const item of round.items) {
      drawSprite(ctx, itemSprite(item), item.x, item.y, itemColors(item));
    }
  }

  // After the round: the cryptid on top of everything (so the tree and
  // bush no longer hide it), in its bright colours, with a box around it.
  function drawReveal(ctx, round) {
    drawSprite(ctx, round.cryptid.sprite, round.cryptidX, round.cryptidY, round.cryptid.foundColors);
    drawRectOutline(ctx, round.spriteBox, HIGHLIGHT);
  }

  // A 5x5 X with a dark shadow, so it shows on sky and on leaves.
  function drawMissMark(ctx, centerX, centerY) {
    for (let i = -2; i <= 2; i++) {
      fillRect(ctx, centerX + i + 1, centerY + i + 1, 1, 1, MISS_SHADOW);
      fillRect(ctx, centerX - i + 1, centerY + i + 1, 1, 1, MISS_SHADOW);
    }
    for (let i = -2; i <= 2; i++) {
      fillRect(ctx, centerX + i, centerY + i, 1, 1, MISS_COLOR);
      fillRect(ctx, centerX - i, centerY + i, 1, 1, MISS_COLOR);
    }
  }

  /* ----------------------------------------------------------
     12. START-UP CHECKS (developer helpers)
     Run once. They explain easy-to-make mistakes in the browser console
     (F12) and leave out any cryptid that would not hide properly, so
     broken art can never show up on stream.
     ---------------------------------------------------------- */
  function warn(text) {
    console.warn('[Spot the Cryptid] ' + text);
  }

  // The row length that shows up most often is almost certainly the
  // width the artist meant, so a typo in ANY row (even row 0) is named.
  function mostCommonRowWidth(sprite) {
    const counts = {};
    let bestWidth = String(sprite[0]).length;
    for (const line of sprite) {
      const width = String(line).length;
      counts[width] = (counts[width] || 0) + 1;
      if (counts[width] > counts[bestWidth]) bestWidth = width;
    }
    return bestWidth;
  }

  // Returns a list of problems with one sprite. Every letter needs a
  // colour in each of the colour maps in "colorMaps".
  function spriteProblems(sprite, colorMaps) {
    if (!Array.isArray(sprite) || sprite.length === 0) return ['it has no rows'];
    const problems = [];
    const expectedWidth = mostCommonRowWidth(sprite);
    sprite.forEach(function (line, row) {
      if (typeof line !== 'string') {
        problems.push('row ' + row + ' is not text in quotes');
        return;
      }
      if (line.length !== expectedWidth) {
        problems.push('row ' + row + ' is ' + line.length + ' wide, expected ' + expectedWidth);
      }
      for (const letter of line) {
        if (letter === '.') continue;
        if (colorMaps.some(function (colors) { return !colors || !colors[letter]; })) {
          problems.push('row ' + row + ' uses "' + letter + '", which has no colour');
        }
      }
    });
    return problems;
  }

  function checkScenery() {
    for (const name in SPRITES) {
      spriteProblems(SPRITES[name], [PALETTE]).forEach(function (problem) {
        warn('Sprite "' + name + '": ' + problem);
      });
    }
    FIXED_ROWS.concat(STEP1_TREES_LEFT, STEP1_TREES_RIGHT).forEach(function (item) {
      if (!SPRITES[item.sprite]) warn('Unknown sprite name in scene.js: "' + item.sprite + '"');
    });
  }

  function cryptidProblems(cryptid) {
    if (!cryptid || typeof cryptid !== 'object') return ['it is not a { ... } entry'];
    const problems = [];
    if (typeof cryptid.name !== 'string' || cryptid.name === '') problems.push('it needs a name');
    if (!cryptid.colors || !cryptid.foundColors) problems.push('it needs colors and foundColors');
    if (!cryptid.tell) problems.push('it needs a tell letter, like E for the eyes');
    if (problems.length > 0) return problems;

    const artProblems = spriteProblems(cryptid.sprite, [cryptid.colors, cryptid.foundColors]);
    if (artProblems.length > 0) return artProblems;
    if (cryptid.sprite.length !== CRYPTID_HEIGHT || spriteWidth(cryptid.sprite) !== CRYPTID_WIDTH) {
      return ['the sprite must be ' + CRYPTID_WIDTH + ' wide and ' + CRYPTID_HEIGHT + ' tall'];
    }
    // The real test: hide it in Step 1's forest and audit that.
    return auditRound(buildStep1Round(cryptid)).problems;
  }

  // How bright a colour looks, from 0 (black) to 1 (white). "#rrggbb"
  // only; anything else gives null (and is simply not checked).
  function luminance(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(String(hex))) return null;
    const value = parseInt(hex.slice(1), 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(function (channel) {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(colorA, colorB) {
    const a = luminance(colorA);
    const b = luminance(colorB);
    if (a === null || b === null) return null;
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  // The letter used most in the peek area, not counting the tell: the
  // "body" colour the eyes must stand out from.
  function mainBodyLetter(cryptid) {
    const counts = {};
    let best = null;
    for (let row = PEEK_AREA.top; row <= PEEK_AREA.bottom; row++) {
      for (let col = PEEK_AREA.left; col <= PEEK_AREA.right; col++) {
        const letter = cryptid.sprite[row].charAt(col);
        if (letter === '.' || letter === cryptid.tell || !cryptid.colors[letter]) continue;
        counts[letter] = (counts[letter] || 0) + 1;
        if (best === null || counts[letter] > counts[best]) best = letter;
      }
    }
    return best;
  }

  // Only a warning: a faint tell still works, it is just hard to see.
  function warnIfTellIsFaint(cryptid) {
    const body = mainBodyLetter(cryptid);
    if (body === null) return;
    const ratio = contrastRatio(cryptid.colors[cryptid.tell], cryptid.colors[body]);
    if (ratio !== null && ratio < MIN_TELL_CONTRAST) {
      warn('Cryptid "' + cryptid.name + '": its tell "' + cryptid.tell + '" has a contrast of only ' +
        ratio.toFixed(2) + ' with its body colour "' + body + '" (aim for ' +
        MIN_TELL_CONTRAST + ' or more), so it may vanish on stream.');
    }
  }

  // Checks everything and returns how many cryptids can be used.
  function checkData() {
    checkScenery();
    const passed = [];
    CRYPTIDS.forEach(function (cryptid, index) {
      const problems = cryptidProblems(cryptid);
      if (problems.length === 0) {
        passed.push(cryptid);
        warnIfTellIsFaint(cryptid);
      } else {
        const label = (cryptid && cryptid.name) || ('number ' + (index + 1));
        warn('Cryptid "' + label + '" is left out of the game: ' + problems.join('; '));
      }
    });
    usableCryptids = passed;
    return passed.length;
  }

  /* ----------------------------------------------------------
     13. SHARED WITH THE OTHER FILES
     ---------------------------------------------------------- */
  return {
    LOGICAL_WIDTH: LOGICAL_WIDTH,
    LOGICAL_HEIGHT: LOGICAL_HEIGHT,
    makeRandom: makeRandom,
    generateRound: generateRound,
    auditRound: auditRound,
    drawForest: drawForest,
    drawReveal: drawReveal,
    drawMissMark: drawMissMark,
    drawRectOutline: drawRectOutline,
    rectsOverlap: rectsOverlap,
    contrastRatio: contrastRatio,
    checkData: checkData,
  };
})();
