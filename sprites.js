/* ==========================================================
   sprites.js  -  ALL THE PIXEL ART (pure data, no logic)

   Loaded FIRST (see the <script> tags at the bottom of index.html).
   It shares three names with the files loaded after it:
     PALETTE   letter -> colour for the scenery sprites
     SPRITES   the scenery pictures, by name (pine, oak, bush, ...)
     CRYPTIDS  every creature that can hide, each with its OWN colours

   How a sprite works: it is an array of strings. Every string is one
   row of pixels and every character is one pixel. '.' is see-through.
   Keep every row of a sprite the same length. scene.js checks all the
   art at start-up and explains any problem in the browser console (F12).
   ========================================================== */
'use strict';

/* ----------------------------------------------------------
   1. SCENERY COLOURS
   The scenery sprites below are "painted" with these letters.
   (Cryptids bring their own colours: see section 3.)
   ---------------------------------------------------------- */
const PALETTE = {
  'K': '#1c140b', // outline / deep shadow
  'T': '#5a3a1e', // tree trunk
  'B': '#7d5433', // trunk highlight
  'D': '#1f4d2b', // dark leaves
  'G': '#2f7d3a', // leaves
  'L': '#5bb04e', // light leaves
  'H': '#244f31', // far-away forest silhouette
  'R': '#6e6e78', // rock
  'P': '#a0a0aa', // rock highlight (pale)
  'S': '#454550', // rock shadow
  'W': '#f4f8fb', // cloud
};

/* ----------------------------------------------------------
   2. SCENERY SPRITES (Step 1's art, plus "oakBush")
   ---------------------------------------------------------- */
const SPRITES = {

  // Tall pine tree, 15 wide x 25 tall
  pine: [
    '.......D.......',
    '......DLD......',
    '......DGD......',
    '.....DLGGD.....',
    '.....DGGGD.....',
    '....DLGGGGD....',
    '....DGGGGGD....',
    '...DDGGGGGDD...',
    '....DLGGGGD....',
    '...DGLGGGGGD...',
    '...DGGGGGGGD...',
    '..DLGGGGGGGGD..',
    '..DGGGGGGGGGD..',
    '.DDDGGGGGGGDDD.',
    '..DLGGGGGGGGD..',
    '.DGGLGGGGGGGGD.',
    '.DGGGGGGGGGGGD.',
    'DLGGGGGGGGGGGGD',
    'DGGGGGGGGGGGGGD',
    'DDDDDDDDDDDDDDD',
    '......TBT......',
    '......TBT......',
    '......TBT......',
    '......TBT......',
    '.....KTBTK.....',
  ],

  // Round leafy oak with a thick trunk, 21 wide x 26 tall
  oak: [
    '.......DDDDDDD.......',
    '.....DDGGGGGGGDD.....',
    '....DGGLLGGGGGGGD....',
    '...DGLLGGGGGGLGGGD...',
    '..DGGLGGGGGGGGGGGGD..',
    '..DGGGGGGGGGGLGGGGD..',
    '.DGGGGGGLGGGGGGGGGGD.',
    '.DGLGGGGGGGGGGGGGGGD.',
    'DGGGGGGGGGGGGGGGGGGGD',
    'DGGGGGGGGGGGGGGLGGGGD',
    'DGGGGGGGLGGGGGGGGGGGD',
    'DGGGGGGGGGGGGGGGGGGGD',
    '.DGGGGGGGGGGGGGGGGGD.',
    '.DDGGGGGGGGGGGGGGGDD.',
    '..DDGGGGDDDDDGGGGDD..',
    '...DDDDDKTBTKDDDDD...',
    '........KTBTK........',
    '........KTBTK........',
    '........KTBTK........',
    '........KTBTK........',
    '........KTBTK........',
    '........KTBTK........',
    '........KTBTK........',
    '........KTBTK........',
    '........KTBTK........',
    '.......KKTBTKK.......',
  ],

  // Bush, 12 wide x 7 tall (the middle and front rows use this one)
  bush: [
    '....DDDD....',
    '..DDGLGGDD..',
    '.DGGLGGGGGD.',
    'DGLGGGGGGLGD',
    'DGGGGGGGGGGD',
    'DDGGGGGGGGDD',
    '.DDDDDDDDDD.',
  ],

  // The bush in front of EVERY back-row oak, 12 wide x 7 tall. The same
  // as "bush", except the top row is 1 pixel wider on each side. Those
  // two pixels cover the cryptid's lowest peeking row, which would
  // otherwise sit on the lighter ground (y 104) and give it away.
  oakBush: [
    '...DDDDDD...',
    '..DDGLGGDD..',
    '.DGGLGGGGGD.',
    'DGLGGGGGGLGD',
    'DGGGGGGGGGGD',
    'DDGGGGGGGGDD',
    '.DDDDDDDDDD.',
  ],

  // Rock, 9 wide x 5 tall
  rock: [
    '..SPPRS..',
    '.SPRRRRS.',
    'SPRRRRRSS',
    'SRRRRSSSS',
    '.SSSSSSS.',
  ],

  // Grass tuft, 5 wide x 3 tall
  grass: [
    '.L.L.',
    'LLGLL',
    '.GGG.',
  ],

  // Cloud, 10 wide x 4 tall
  cloud: [
    '....WWW...',
    '..WWWWWWW.',
    '.WWWWWWWW.',
    'WWWWWWWWWW',
  ],

  // Tiny distant pine used for the far treeline, 7 wide x 7 tall
  farPine: [
    '...H...',
    '..HHH..',
    '..HHH..',
    '.HHHHH.',
    '.HHHHH.',
    'HHHHHHH',
    'HHHHHHH',
  ],
};

/* ----------------------------------------------------------
   3. CRYPTIDS
   One of these is picked at random every round (never the same one
   twice in a row).

   TO ADD YOUR OWN: copy a whole { ... } entry below and change it.
     name         shown in messages ("Nobody found the Mothman!")
     sprite       9 wide x 15 tall, drawn with ANY letters you like
     colors       letter -> colour while it hides (dark!)
     foundColors  letter -> colour once it is found (bright!)
     tell         the letter of its one giveaway, usually the eyes

   Rules that keep it hidden behind the oak + bush. scene.js tests every
   cryptid at start-up; one that breaks a rule is LEFT OUT of the game,
   and the console (F12) says exactly which pixel or row is wrong.
     - Exactly 9 wide x 15 tall, the same box as the sasquatch.
     - Row 1 column 0 and row 14 column 8 must be '.': the tree and the
       bush do not cover those two corners.
     - Rows 2 to 7, columns 0 to 5 PEEK OUT to the left of the trunk.
       Paint that part in dark colours with ONE small tell (the eyes),
       and put at least one tell pixel inside that area.
     - Make the tell clearly lighter than the body (the console warns
       if it is too faint to see on a compressed stream).
   ---------------------------------------------------------- */
const CRYPTIDS = [
  {
    name: 'Sasquatch',
    // Step 1's tested art, unchanged. No black outline on purpose:
    // a soft, dark silhouette hides better.
    sprite: [
      '..NFFFN..', //  0  covered by the oak's leaves
      '.NFFFFFN.', //  1
      '.NFEFEFN.', //  2  <- rows 2-7, columns 0-5 peek out
      '.NFFFFFN.', //  3
      '..NFFFN..', //  4
      '.NFFFFFN.', //  5
      'NFFFFFFFN', //  6
      'NFNFFFNFN', //  7
      'NFNFFFNFN', //  8  covered by the bush from here down
      'NFNFFFNFN', //  9
      'NFNFFFNFN', // 10
      '.NNFFFNN.', // 11
      '..NFNFN..', // 12
      '..NFNFN..', // 13
      '.NNN.NNN.', // 14
    ],
    colors: {
      'N': '#241a0e', // fur shadow (almost the trunk outline colour K)
      'F': '#3b2b1a', // fur (between the trunk colours on purpose)
      'E': '#9c8a48', // eyes: dull gold - the one honest giveaway
    },
    foundColors: { 'N': '#4a2e14', 'F': '#9c6b3c', 'E': '#ffe066' },
    tell: 'E',
  },
  {
    name: 'Mothman',
    // Wings folded down like a cloak. The tell: two dull red eyes, also
    // clearly LIGHTER than the body, so viewers who can't tell red from
    // green (and blurry stream video) still show them.
    sprite: [
      '.N.....N.', //  0  antennae
      '..N...N..', //  1
      '..NFFFN..', //  2  <- peeks out
      '.NFEFEFN.', //  3  red eyes
      '.NFFFFFN.', //  4
      'NANFFFNAN', //  5  folded wings start
      'NAANFNAAN', //  6
      'NAAFFFAAN', //  7
      'NAAFFFAAN', //  8  covered by the bush from here down
      'NAAFFFAAN', //  9
      '.NAFFFAN.', // 10
      '..NFFFN..', // 11
      '..NF.FN..', // 12
      '..NF.FN..', // 13
      '.NN...NN.', // 14
    ],
    colors: {
      'N': '#1b171d', // shadow
      'F': '#2d2731', // body: dark grey-violet, close to the trunk shadow
      'A': '#241f28', // folded wings
      'E': '#c8503f', // eyes: dull red - the tell
    },
    foundColors: { 'N': '#2e2638', 'F': '#6d6280', 'A': '#4a4058', 'E': '#ff3b30' },
    tell: 'E',
  },
  {
    name: 'Chupacabra',
    // Big head, spines down its back. Dark olive melts into the far
    // forest. The tell: two dull yellow-green eyes.
    sprite: [
      '...X.X...', //  0  spines
      '..XNXNX..', //  1
      '.NFFFFFN.', //  2  <- peeks out
      'NFEFFEFN.', //  3  eyes
      '.NFFFFFNX', //  4
      '..NFFFNX.', //  5
      '.NFFFFFNX', //  6
      'NFNFFFNFX', //  7
      'NFNFFFNXN', //  8  covered by the bush from here down
      'NFNFFFNXN', //  9
      '.N.NFFNX.', // 10
      '..NFFFN..', // 11
      '..NF.FN..', // 12
      '.NF..NF..', // 13
      'NN...NN..', // 14
    ],
    colors: {
      'N': '#161d16', // shadow
      'F': '#26321f', // scaly skin: dark olive, close to the far forest
      'X': '#1e281a', // back spines
      'E': '#7e8a3c', // eyes: dull yellow-green - the tell
    },
    foundColors: { 'N': '#2c3d26', 'F': '#6f8f4f', 'X': '#c0406a', 'E': '#e6ff3c' },
    tell: 'E',
  },
];
