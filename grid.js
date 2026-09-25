/* ==========================================================
   grid.js  -  THE GUESSING GRID AND READING "!spot C4" FROM CHAT

   Needs:  scene.js (Scene), loaded before it.
   Shares: one object called Grid.

   Viewers can't click on a stream, so the forest is cut into labelled
   squares ("cells") like a chess board: columns A, B, C ... from left to
   right and rows 1, 2, 3 ... from top to bottom. "!spot C4" in chat
   means column C, row 4.

   This file does three jobs:
     1. cell maths   which pixels a cell covers, which cell a pixel is in
     2. reading chat turning "!spot c 4" into a cell (or ignoring it)
     3. labels       the A-P / 1-9 labels along the edges (HTML on top of
                     the canvas, so the letters stay sharp in OBS)
   The grid LINES are drawn by style.css; game.js tells it CELL_SIZE.
   ========================================================== */
const Grid = (function () {
  'use strict';

  /* ----------------------------------------------------------
     1. SETTINGS
     ---------------------------------------------------------- */
  // Size of one cell in logical pixels. 20 cuts the 320x180 picture into
  // exactly 16 columns (A-P) x 9 rows (1-9). At 1080p each cell is
  // 120x120 screen pixels: easy to aim at on a compressed stream.
  // Any whole number from 13 up works (13 gives 25 columns; 12 would need
  // 27 letters, one more than A-Z). Only 20 divides 320x180 exactly;
  // other sizes make the last column and row a bit thinner, which is fine.
  const CELL_SIZE = 20;

  const COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const MAX_ROWS = 99;                  // "!spot C4" reads at most 2 digits
  // Math.ceil: a thinner last column/row still gets a label, so every
  // pixel of the forest can be guessed.
  const COLUMNS = Math.ceil(Scene.LOGICAL_WIDTH / CELL_SIZE);
  const ROWS = Math.ceil(Scene.LOGICAL_HEIGHT / CELL_SIZE);

  // The chat command, and the example shown on screen.
  const COMMAND = '!spot';
  const EXAMPLE = '!spot C4';

  // Labels sit this many logical pixels in from each edge (their centre).
  const LABEL_INSET = 3;

  // Only the start of a message is read: a guess is always at the start,
  // and a very long message is chatter, not a guess.
  const MAX_CHARACTERS_TO_READ = 80;

  // Invisible characters that chat apps add to messages. Removing them
  // lets "!spot C4" + an invisible tail still count. Written as \u{...} escapes
  // on purpose (never paste the real characters into code: you can't see
  // them, and some of them even flip how the line is displayed):
  //   U+00AD           soft hyphen
  //   U+034F           combining grapheme joiner
  //   U+200B - U+200D  zero-width space / non-joiner / joiner
  //   U+2060           word joiner
  //   U+FEFF           zero-width no-break space
  //   U+E0000 - U+E007F  "tag" characters (7TV and Chatterino add U+E0000
  //                      so the same message can be sent twice)
  const INVISIBLE_CHARACTERS = /[\u{AD}\u{34F}\u{200B}-\u{200D}\u{2060}\u{FEFF}\u{E0000}-\u{E007F}]/gu;

  // After "!spot": a letter, optional spaces, 1 or 2 digits, and then NOT
  // another letter or digit. "c4", "c 4", "c4!" and "c4 by the oak"
  // match; "c4x" does not.
  const CELL_AFTER_COMMAND = /^([a-z])\s*(\d{1,2})(?![a-z0-9])/;

  // A message that is ONLY a cell: "c4" or "c 4" (nothing else at all,
  // so ordinary chat like "i think a1" is ignored). These "bare" guesses
  // are OFF unless the address has ?bare=1, because normal chat is full
  // of them: "o7" is a salute emote, "b4" means "before"...
  const BARE_CELL = /^([a-z])\s*(\d{1,2})$/;
  // Even with ?bare=1, these common chat words are never guesses.
  // (Typing "!spot o7" still guesses O7.)
  const BARE_IGNORE = ['o7', 'b4', 'l8', 'a1', 'f1', 'f2'];

  /* ----------------------------------------------------------
     2. CELL MATHS
     A cell is { col, row, name }. col and row count from 0, the name
     is what people type: { col: 2, row: 3, name: 'C4' }.
     ---------------------------------------------------------- */
  function columnLetter(col) {
    return COLUMN_LETTERS.charAt(col);
  }

  function makeCell(col, row) {
    return { col: col, row: row, name: columnLetter(col) + (row + 1) };
  }

  // The logical-pixel rectangle a cell covers.
  function cellRect(cell) {
    return { x: cell.col * CELL_SIZE, y: cell.row * CELL_SIZE, width: CELL_SIZE, height: CELL_SIZE };
  }

  // The cell that contains logical pixel (x, y), e.g. under the mouse.
  function cellAt(x, y) {
    const col = Math.min(COLUMNS - 1, Math.max(0, Math.floor(x / CELL_SIZE)));
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL_SIZE)));
    return makeCell(col, row);
  }

  // THE HIT RULE: a cell hits if any part of it overlaps the box.
  function cellHitsBox(cell, box) {
    return Scene.rectsOverlap(cellRect(cell), box);
  }

  // Every cell that overlaps a box ("it was hiding in J5 J6").
  function cellsOverlapping(box) {
    const cells = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        const cell = makeCell(col, row);
        if (cellHitsBox(cell, box)) cells.push(cell);
      }
    }
    return cells;
  }

  /* ----------------------------------------------------------
     3. READING CHAT
     parseGuess(text, allowBareCell) returns one of:
       null                     not a guess at all: ignore it quietly
       { cell }                 a "!spot" guess
       { cell, bare: true }     a bare "C4" guess (only with ?bare=1)
       { error: '...' }         "!spot" with no usable cell: worth a hint
     ---------------------------------------------------------- */
  // ("c", "4") -> the cell C4, or null when it is off the grid.
  function cellFromParts(letter, digits) {
    const col = letter.charCodeAt(0) - 'a'.charCodeAt(0);
    const row = parseInt(digits, 10) - 1;
    if (col < 0 || col >= COLUMNS) return null;
    if (!(row >= 0 && row < ROWS)) return null;   // also catches NaN
    return makeCell(col, row);
  }

  function parseGuess(text, allowBareCell) {
    if (typeof text !== 'string') return null;
    const message = text.replace(INVISIBLE_CHARACTERS, '')
      .slice(0, MAX_CHARACTERS_TO_READ)
      .trim()
      .toLowerCase();
    const command = COMMAND.toLowerCase();

    if (message.indexOf(command) === 0) {
      const rest = message.slice(command.length);
      // "!spotted" or "!spotify" are other words, not our command.
      if (/^[a-z]{2}/.test(rest)) return null;
      const match = CELL_AFTER_COMMAND.exec(rest.trim());
      const cell = match ? cellFromParts(match[1], match[2]) : null;
      return cell ? { cell: cell } : { error: 'try ' + EXAMPLE };
    }

    if (!allowBareCell) return null;
    const match = BARE_CELL.exec(message);
    if (!match || BARE_IGNORE.indexOf(match[1] + match[2]) !== -1) return null;
    const cell = cellFromParts(match[1], match[2]);
    return cell ? { cell: cell, bare: true } : null;
  }

  /* ----------------------------------------------------------
     4. LABELS (HTML on top of the canvas)
     Letters along the top and bottom, numbers down both sides: only the
     edges, because labels inside the cells would cover the tree line.
     style.css turns --x and --y (logical pixels) into screen pixels.
     ---------------------------------------------------------- */
  const columnLabels = [];   // columnLabels[col] = [top label, bottom label]

  function addLabel(container, text, x, y) {
    const label = document.createElement('span');
    label.className = 'grid-label';
    label.textContent = text;
    label.style.setProperty('--x', x);
    label.style.setProperty('--y', y);
    container.appendChild(label);
    return label;
  }

  // The middle of the visible part of cell number "index" (the last
  // cell may be cut off by the edge of the picture).
  function cellMiddle(index, pictureSize) {
    const start = index * CELL_SIZE;
    const end = Math.min(start + CELL_SIZE, pictureSize);
    return (start + end) / 2;
  }

  function buildLabels(container) {
    container.textContent = '';
    columnLabels.length = 0;
    for (let col = 0; col < COLUMNS; col++) {
      const x = cellMiddle(col, Scene.LOGICAL_WIDTH);
      columnLabels.push([
        addLabel(container, columnLetter(col), x, LABEL_INSET),
        addLabel(container, columnLetter(col), x, Scene.LOGICAL_HEIGHT - LABEL_INSET),
      ]);
    }
    for (let row = 0; row < ROWS; row++) {
      const y = cellMiddle(row, Scene.LOGICAL_HEIGHT);
      addLabel(container, String(row + 1), LABEL_INSET, y);
      addLabel(container, String(row + 1), Scene.LOGICAL_WIDTH - LABEL_INSET, y);
    }
  }

  // Light up the column letters from first to last (the mid-round hint).
  // highlightColumns(null) switches them all off.
  function highlightColumns(first, last) {
    columnLabels.forEach(function (labels, col) {
      const lit = first !== null && col >= first && col <= last;
      labels.forEach(function (label) { label.classList.toggle('is-hint', lit); });
    });
  }

  /* ----------------------------------------------------------
     5. SETTINGS CHECK
     Returns a list of problems that stop the game (shown on screen).
     ---------------------------------------------------------- */
  function checkSettings() {
    if (!Number.isInteger(CELL_SIZE) || CELL_SIZE < 1) {
      return ['Grid: CELL_SIZE must be a whole number (like 20)'];
    }
    const problems = [];
    if (COLUMNS > COLUMN_LETTERS.length) {
      problems.push('Grid: CELL_SIZE ' + CELL_SIZE + ' makes ' + COLUMNS +
        ' columns, but there are only 26 letters. Use 13 or more.');
    }
    if (ROWS > MAX_ROWS) {
      problems.push('Grid: CELL_SIZE ' + CELL_SIZE + ' makes more than ' + MAX_ROWS + ' rows.');
    }
    if (Scene.LOGICAL_WIDTH % CELL_SIZE !== 0 || Scene.LOGICAL_HEIGHT % CELL_SIZE !== 0) {
      console.warn('[Spot the Cryptid] Grid: CELL_SIZE ' + CELL_SIZE + ' does not divide 320x180 ' +
        'exactly, so the last column and row are thinner. That works; 20 fits exactly.');
    }
    return problems;
  }

  return {
    CELL_SIZE: CELL_SIZE,
    COLUMNS: COLUMNS,
    ROWS: ROWS,
    COMMAND: COMMAND,
    EXAMPLE: EXAMPLE,
    columnLetter: columnLetter,
    makeCell: makeCell,
    cellRect: cellRect,
    cellAt: cellAt,
    cellHitsBox: cellHitsBox,
    cellsOverlapping: cellsOverlapping,
    parseGuess: parseGuess,
    buildLabels: buildLabels,
    highlightColumns: highlightColumns,
    checkSettings: checkSettings,
  };
})();
