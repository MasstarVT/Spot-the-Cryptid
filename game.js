/* ==========================================================
   game.js  -  THE GAME: rounds, guesses, scoreboard and screen text

   Needs (loaded before it): sprites.js, scene.js, grid.js, twitch.js.
   Load it LAST, because it starts the game.
   Shares one object called Game, handy in the browser console (F12):
     Game.handleChatGuess('alice', '!spot C4')  pretend alice typed that
     Game.newRound()       start a new round now               (key N)
     Game.reveal()         end the round and show the cryptid  (key R)
     Game.resetScores()    clear this channel's scoreboard     (key X twice)
     Game.changeChannel()  back to the "Twitch channel" box    (key C)
     Game.debugAnswer()    the cells that would hit right now (no peeking on stream!)
     Game.getState()       which STATE the game is in

   The game is always in exactly ONE state:

     NEED_CHANNEL   no ?channel= in the address (or key C): the "Twitch
          |         channel" box shows. The streamer types a channel and
          |         presses Connect.
          v
     CONNECTING     waiting for Twitch to let us into the chat
          |         joined (or key N, or ?debug=1)
          v
     ROUND_ACTIVE   timer running, guesses count  <--------------------+
          |  a guess hits              |  time runs out (or key R)     |
          v                            v                               |
     FOUND (winner banner)       TIMEOUT (answer shown)                |
          |  after REVEAL_MS the cryptid hides somewhere new ----------+

   ONE steady "game clock" (tick, 4 times a second) does everything that
   takes time. Each state only stores WHEN it ends, so there are no
   per-round timers that could be forgotten and pile up on a long stream.
   While chat is disconnected, the round timer pauses, so viewers never
   lose a round they could not play.
   ========================================================== */
const Game = (function () {
  'use strict';

  /* ----------------------------------------------------------
     1. SETTINGS (change these freely)
     The grid size and the chat command live in grid.js.
     ---------------------------------------------------------- */
  // Rounds
  const DEFAULT_ROUND_SECONDS = 120;   // change per stream with ?round=90
  const MIN_ROUND_SECONDS = 15;
  const MAX_ROUND_SECONDS = 3600;
  const REVEAL_MS = 6000;              // how long the found cryptid stays on screen
  const HINT_AT_FRACTION = 0.5;        // column hint after half the round (0 = no hint)
  const HINT_COLUMN_SPAN = 4;          // "Hint: columns F-I"
  const LOW_TIME_SECONDS = 10;         // the timer turns red
  const TICK_MS = 250;                 // how often the game clock looks at the time

  // Guesses. Each viewer gets a few guesses per round AND must wait
  // between them, so a big chat can't just try every oak in the forest.
  const DEFAULT_GUESSES_PER_ROUND = 3; // change per stream with ?guesses=5
  const MAX_GUESSES_PER_ROUND = 99;
  const GUESS_COOLDOWN_MS = 8000;      // one judged guess per viewer every 8 seconds

  // On-screen lists and messages
  const FEED_LENGTH = 5;
  const LEADERBOARD_SIZE = 5;
  const NOTICE_MS = 3000;
  const RESET_CONFIRM_MS = 3000;       // press X twice within 3 s to reset the scores
  const ANSWER_FRAME_COLOR = 'rgba(255, 216, 74, 0.7)';

  // Shift+click on the forest is the streamer testing. It uses exactly
  // the chat rule, but never scores and has no limits. (A plain click
  // does nothing, so clicking to give the page keyboard focus is safe.)
  const STREAMER = { id: 'streamer', name: 'Streamer', scored: false };

  // Everything saved in the browser starts with this, so it is easy to find.
  const STORAGE_PREFIX = 'spotTheCryptid.';
  const OFFLINE_BOARD = '(offline)';   // scoreboard used in offline test mode

  // Every sentence the game shows, in one place. {name} is filled in.
  const TEXT = {
    title: 'Spot the Cryptid',
    enterChannel: 'Type your Twitch channel to start',
    badChannelName: 'Use letters, numbers and _ only',
    notAChannel: '"{name}" is not a Twitch channel name',
    waitingForChat: 'Waiting for chat',
    changeChannelTip: 'Press C to change the channel',
    goal: 'Find the {cryptid}!\nType {example} in chat',
    guessesEach: 'Guesses each: {count}',
    hint: 'Hint: columns {first}-{last}',
    clock: 'Round {number}  {time}',
    paused: 'Round {number}  PAUSED (chat offline)',
    nextRound: 'Next round in {seconds}',
    found: '{name} found the {cryptid}!',
    foundDetail: 'Cell {cell}  +1 point ({total} total)',
    testDetail: 'Cell {cell}  (test, no points)',
    nobodyFound: 'Nobody found the {cryptid}!',
    revealed: 'The {cryptid} was hiding here!',
    answer: 'It was in {cells}',
    foundBy: 'Found by {name}!',
    timeUp: 'Time is up!',
    revealedByStreamer: 'Revealed by the streamer',
    feedMiss: 'miss',
    feedMissLeft: 'miss ({left} left)',
    feedHit: 'FOUND IT!',
    feedChecked: 'already checked',
    feedOut: 'out of guesses',
    pressXAgain: 'Press X again to reset the scoreboard',
    scoresReset: 'Scoreboard reset',
    scoresResetFromUrl: 'Scoreboard reset (from the address)',
    connectFirst: 'Connect to a channel first',
    timerWaits: 'New round - the timer starts when chat connects',
    notConnected: 'Not connected',
    offline: 'Offline test mode (no channel)',
    noFinds: 'No finds yet',
    noCryptids: 'No cryptid passed its hiding check - see the console (F12).',
    startFailed: 'Something went wrong while starting - see the console (F12).',
  };

  const STATE = Object.freeze({
    NEED_CHANNEL: 'NEED_CHANNEL',
    CONNECTING: 'CONNECTING',
    ROUND_ACTIVE: 'ROUND_ACTIVE',
    FOUND: 'FOUND',
    TIMEOUT: 'TIMEOUT',
  });

  /* ----------------------------------------------------------
     2. URL SETTINGS
     index.html?channel=name&round=90&guesses=3&bare=1&debug=1&seed=42&reset=1
     ---------------------------------------------------------- */
  const urlParams = new URLSearchParams(window.location.search);
  const SETTINGS = {
    rawChannel: urlParams.get('channel') || '',
    roundMs: readNumberParam('round', DEFAULT_ROUND_SECONDS, MIN_ROUND_SECONDS, MAX_ROUND_SECONDS) * 1000,
    guessesPerRound: readNumberParam('guesses', DEFAULT_GUESSES_PER_ROUND, 1, MAX_GUESSES_PER_ROUND),
    // A bare "C4" (without !spot) counts only with ?bare=1: normal chat
    // is full of things like "o7" and "b4" that look like cells.
    allowBareCell: urlParams.get('bare') === '1',
    debug: urlParams.get('debug') === '1',
    fixedSeed: urlParams.has('seed') ? readNumberParam('seed', 0, 0, 4294967295) : null,
    resetToken: urlParams.get('reset') || '',
    inObs: Boolean(window.obsstudio),                  // OBS adds "obsstudio" to its browser sources
  };

  /* ----------------------------------------------------------
     3. GAME DATA
     ---------------------------------------------------------- */
  const game = {
    state: STATE.NEED_CHANNEL,
    usingChat: false,           // false in offline test mode
    chatOnline: false,          // are we in the chat right now?
    round: null,                // everything about this round (see startRound)
    roundNumber: 0,
    board: '',                  // which scoreboard is loaded ('' = none yet)
    scores: Object.create(null),// player id -> { name, points, at }
    feed: [],                   // recent guesses, newest last
    resetArmedAt: -Infinity,    // when X was pressed the first time
    noticeTimer: null,
  };

  // Page elements, looked up in boot().
  const el = {};
  let ctx = null;

  // The forest is painted once per round onto this hidden canvas. Every
  // redraw after that is one quick copy plus the X marks, so a busy chat
  // never repaints thousands of tree pixels per guess.
  const forestCanvas = document.createElement('canvas');
  const forestCtx = forestCanvas.getContext('2d');

  /* ----------------------------------------------------------
     4. SMALL HELPERS
     ---------------------------------------------------------- */
  function byId(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // ?round=90 -> 90. Missing or nonsense -> the default. Kept in range.
  function readNumberParam(name, defaultValue, min, max) {
    const value = parseInt(urlParams.get(name), 10);
    if (!Number.isFinite(value)) return defaultValue;
    return clamp(value, min, max);
  }

  // format('Hi {name}!', { name: 'Ann' }) -> 'Hi Ann!'
  function format(template, values) {
    return template.replace(/\{(\w+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole;
    });
  }

  // 83000 ms -> "1:23"
  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
  }

  // Test names get the same clean-up as chat names (control characters out).
  function cleanName(name) {
    return String(name || '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 25) || 'Tester';
  }

  // localStorage can be missing or throw (private windows, blocked
  // storage, file:// in some browsers). The game then just doesn't
  // remember anything, and keeps running.
  function storageGet(key) {
    try {
      return window.localStorage.getItem(STORAGE_PREFIX + key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, value);
    } catch (error) {
      // Storage is off or full: it still works until the page reloads.
    }
  }

  // Change one ?name=value in the address bar without reloading.
  // value null removes it. Some browsers refuse this on file:// - fine.
  function setUrlParam(name, value) {
    try {
      const url = new URL(window.location.href);
      if (value === null) url.searchParams.delete(name);
      else url.searchParams.set(name, value);
      window.history.replaceState(null, '', url.href);
    } catch (error) {
      // The game still works; only a reload would forget the change.
    }
  }

  function setState(next) {
    game.state = next;
  }

  function isRevealing() {
    return game.state === STATE.FOUND || game.state === STATE.TIMEOUT;
  }

  /* ----------------------------------------------------------
     5. DRAWING THE CANVAS
     ---------------------------------------------------------- */
  function bakeForest(forest) {
    Scene.drawForest(forestCtx, forest);
  }

  // The middle of the visible part of a cell (for the X marks).
  function cellCentre(cell) {
    const rect = Grid.cellRect(cell);
    const width = Math.min(rect.width, Scene.LOGICAL_WIDTH - rect.x);
    const height = Math.min(rect.height, Scene.LOGICAL_HEIGHT - rect.y);
    return { x: rect.x + Math.floor(width / 2), y: rect.y + Math.floor(height / 2) };
  }

  // The cells that would hit this round.
  function answerCells() {
    return Grid.cellsOverlapping(game.round.forest.hitBox);
  }

  // Redraw after anything changed. Missed cells get a red X, so chat can
  // see what is already checked. A missed cell never touches the part of
  // the cryptid that peeks out, so an X can never cover it.
  function render() {
    ctx.drawImage(forestCanvas, 0, 0);
    const round = game.round;
    if (!round) return;
    round.checkedCells.forEach(function (entry) {
      if (entry.hit) return;
      const centre = cellCentre(entry.cell);
      Scene.drawMissMark(ctx, centre.x, centre.y);
    });
    if (isRevealing()) {
      answerCells().forEach(function (cell) {
        Scene.drawRectOutline(ctx, Grid.cellRect(cell), ANSWER_FRAME_COLOR);
      });
      Scene.drawReveal(ctx, round.forest);
    }
  }

  /* ----------------------------------------------------------
     6. ROUNDS
     ---------------------------------------------------------- */
  // ?seed=42 gives rounds 42, 43, 44... (repeatable). Otherwise random.
  function seedForRound(roundNumber) {
    if (SETTINGS.fixedSeed !== null) return (SETTINGS.fixedSeed + roundNumber - 1) >>> 0;
    return Math.floor(Math.random() * 4294967296);
  }

  function startRound() {
    const previousCryptid = game.round ? game.round.forest.cryptid.name : null;
    game.roundNumber += 1;
    const seed = seedForRound(game.roundNumber);
    const forest = Scene.generateRound(seed, previousCryptid);

    // A fresh object each round: old guesses and cooldowns are simply
    // thrown away, so nothing piles up over a long stream.
    game.round = {
      number: game.roundNumber,
      seed: seed,
      forest: forest,
      remainingMs: SETTINGS.roundMs,
      endsAt: performance.now() + SETTINGS.roundMs,
      paused: false,
      revealEndsAt: 0,
      hint: null,                // { first, last } once the hint is shown
      players: new Map(),        // player id -> this round's record (see roundRecordFor)
      checkedCells: new Map(),   // "C4" -> { cell, hit }
    };
    game.feed = [];              // old guesses were about the old forest

    setState(STATE.ROUND_ACTIVE);
    bakeForest(forest);
    hideBanner();
    Grid.highlightColumns(null);
    renderFeed();
    renderRoundInfo();
    if (shouldPause()) pauseRound();
    render();
    renderTimer();
    setText(el.debugInfo, 'round ' + game.round.number + ', seed ' + seed);
  }

  // outcome: 'found' (winner = { player, cell, total }), 'timeout' or 'revealed'.
  function endRound(outcome, winner) {
    if (game.state !== STATE.ROUND_ACTIVE) return;
    const round = game.round;
    const cryptidName = round.forest.cryptid.name;
    setState(outcome === 'found' ? STATE.FOUND : STATE.TIMEOUT);
    round.revealEndsAt = performance.now() + REVEAL_MS;
    Grid.highlightColumns(null);

    if (outcome === 'found') {
      const detail = winner.player.scored
        ? format(TEXT.foundDetail, { cell: winner.cell.name, total: winner.total })
        : format(TEXT.testDetail, { cell: winner.cell.name });
      showBanner(format(TEXT.found, { name: winner.player.name, cryptid: cryptidName }), detail);
      setText(el.hint, format(TEXT.foundBy, { name: winner.player.name }));
    } else {
      const byStreamer = outcome === 'revealed';
      const cells = answerCells().map(function (cell) { return cell.name; }).join(' ');
      showBanner(format(byStreamer ? TEXT.revealed : TEXT.nobodyFound, { cryptid: cryptidName }),
        format(TEXT.answer, { cells: cells }));
      setText(el.hint, byStreamer ? TEXT.revealedByStreamer : TEXT.timeUp);
    }
    render();
    renderTimer();
  }

  // The game clock.
  function tick() {
    const round = game.round;
    if (!round) return;
    const now = performance.now();
    if (game.state === STATE.ROUND_ACTIVE) {
      if (!round.paused) round.remainingMs = Math.max(0, round.endsAt - now);
      maybeGiveHint();
      if (round.remainingMs <= 0) {
        endRound('timeout', null);
        return;
      }
    } else if (isRevealing() && now >= round.revealEndsAt) {
      startRound();
      return;
    }
    renderTimer();
  }

  // Pause only when we are really playing with chat and chat is gone.
  // (Offline test mode and ?debug=1 never pause.)
  function shouldPause() {
    return game.usingChat && !game.chatOnline && !SETTINGS.debug;
  }

  function pauseRound() {
    const round = game.round;
    if (game.state !== STATE.ROUND_ACTIVE || round.paused) return;
    round.remainingMs = Math.max(0, round.endsAt - performance.now());
    round.paused = true;
    renderTimer();
  }

  function resumeRound() {
    const round = game.round;
    if (game.state !== STATE.ROUND_ACTIVE || !round.paused) return;
    round.paused = false;
    round.endsAt = performance.now() + round.remainingMs;
    renderTimer();
  }

  // Halfway through: light up a few columns, one of which holds the
  // cryptid. Picked from the round's seed, so ?seed= replays it too.
  function maybeGiveHint() {
    const round = game.round;
    if (round.hint || HINT_AT_FRACTION <= 0) return;
    const elapsed = SETTINGS.roundMs - round.remainingMs;
    if (elapsed < SETTINGS.roundMs * HINT_AT_FRACTION) return;

    const cols = answerCells().map(function (cell) { return cell.col; });
    const firstCol = Math.min.apply(null, cols);
    const lastCol = Math.max.apply(null, cols);
    const span = Math.min(HINT_COLUMN_SPAN, Grid.COLUMNS);
    const lowestStart = Math.max(0, lastCol - span + 1);
    const highestStart = Math.max(lowestStart, Math.min(firstCol, Grid.COLUMNS - span));
    const random = Scene.makeRandom(round.seed ^ 0x9E3779B9);
    const first = lowestStart + Math.floor(random() * (highestStart - lowestStart + 1));

    round.hint = { first: first, last: first + span - 1 };
    Grid.highlightColumns(round.hint.first, round.hint.last);
    renderRoundInfo();
  }

  /* ----------------------------------------------------------
     7. GUESSES
     Chat, the test box and Shift+clicks all end up in checkGuess().
     ---------------------------------------------------------- */
  // This round's record for one player. The "told..." flags make sure
  // each kind of info line appears once per player per round, so a busy
  // chat can't push real guesses out of the 5-line feed.
  function roundRecordFor(playerId) {
    let record = game.round.players.get(playerId);
    if (!record) {
      record = {
        lastGuessAt: -Infinity,     // when their last guess was JUDGED (for the cooldown)
        guessesUsed: 0,
        toldBadCell: false,
        toldChecked: false,
        toldOutOfGuesses: false,
      };
      game.round.players.set(playerId, record);
    }
    return record;
  }

  // Every chat message comes through here: { name, userId, text }.
  // Returns what happened as a word (handy for testing): 'no-round',
  // 'not-a-guess', 'bad-cell', 'no-guesses-left', 'cooldown',
  // 'already-checked', 'miss' or 'hit'.
  function handleChatMessage(message) {
    if (game.state !== STATE.ROUND_ACTIVE) return 'no-round';
    const parsed = Grid.parseGuess(message.text, SETTINGS.allowBareCell);
    if (!parsed) return 'not-a-guess';   // ordinary chat: ignored quietly

    const player = { id: message.userId, name: message.name, scored: message.scored !== false };
    const record = roundRecordFor(player.id);

    // A typo costs nothing (no guess, no cooldown), so a quick
    // "!spot C4" right after it still counts.
    if (parsed.error) {
      if (!record.toldBadCell) {
        record.toldBadCell = true;
        addToFeed(player.name, '?', parsed.error, 'info');
      }
      return 'bad-cell';
    }
    if (record.guessesUsed >= SETTINGS.guessesPerRound) {
      if (!record.toldOutOfGuesses) {   // say it once, not on every message
        record.toldOutOfGuesses = true;
        addToFeed(player.name, '', TEXT.feedOut, 'info');
      }
      return 'no-guesses-left';
    }
    if (performance.now() - record.lastGuessAt < GUESS_COOLDOWN_MS) return 'cooldown';   // quietly: no feed spam
    // A bare "C4" that was already checked is probably just chat: stay quiet.
    if (parsed.bare && game.round.checkedCells.has(parsed.cell.name)) return 'already-checked';
    return checkGuess(parsed.cell, player, record);
  }

  // THE heart of the game: the one place a guess is judged.
  // record is null for the streamer (no limits).
  function checkGuess(cell, player, record) {
    if (game.state !== STATE.ROUND_ACTIVE) return 'no-round';
    const round = game.round;
    if (round.checkedCells.has(cell.name)) {
      // Costs no guess and no cooldown. Said once per player per round:
      // the red X already shows everyone that the cell is checked.
      if (!record || !record.toldChecked) {
        if (record) record.toldChecked = true;
        addToFeed(player.name, cell.name, TEXT.feedChecked, 'info');
      }
      return 'already-checked';
    }
    if (record) {
      record.guessesUsed += 1;
      record.lastGuessAt = performance.now();
    }

    // A cell hits if it touches the part of the cryptid that peeks out
    // (plus 1 pixel). A cell is more than 3x wider than that part, so a
    // viewer who points at the eyes always hits, but a guess at the
    // hidden body behind the trunk usually doesn't.
    const hit = Grid.cellHitsBox(cell, round.forest.hitBox);
    round.checkedCells.set(cell.name, { cell: cell, hit: hit });

    if (!hit) {
      const result = record
        ? format(TEXT.feedMissLeft, { left: SETTINGS.guessesPerRound - record.guessesUsed })
        : TEXT.feedMiss;
      addToFeed(player.name, cell.name, result, 'miss');
      render();
      return 'miss';
    }

    addToFeed(player.name, cell.name, TEXT.feedHit, 'hit');
    const total = player.scored ? addPoint(player) : 0;
    endRound('found', { player: player, cell: cell, total: total });
    return 'hit';
  }

  // TEST HOOK - pretend a chat message arrived, no Twitch needed:
  //   Game.handleChatGuess('alice', '!spot C4')
  // Test players score only in offline mode, so testing never puts a
  // fake name on a real channel's scoreboard.
  function handleChatGuess(name, text, userId) {
    const cleanTestName = cleanName(name);
    return handleChatMessage({
      name: cleanTestName,
      userId: 'test:' + (userId ? String(userId) : cleanTestName.toLowerCase()),
      text: String(text),
      scored: !game.usingChat,
    });
  }

  // SHIFT+click guesses the CELL under the mouse with exactly the chat
  // rule, so the streamer tests what viewers experience. A plain click
  // does nothing: the streamer clicks the page to give it keyboard focus,
  // and that must not put a guess on stream.
  function handleCanvasClick(event) {
    if (!event.shiftKey || game.state !== STATE.ROUND_ACTIVE) return;
    const point = getLogicalClickPosition(event);
    checkGuess(Grid.cellAt(point.x, point.y), STREAMER, null);
  }

  // Convert a mouse position on screen into logical canvas pixels
  // (from Step 1). Works at any zoom or scale.
  function getLogicalClickPosition(event) {
    const rect = el.canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * Scene.LOGICAL_WIDTH);
    const y = Math.floor((event.clientY - rect.top) / rect.height * Scene.LOGICAL_HEIGHT);
    return {
      x: clamp(x, 0, Scene.LOGICAL_WIDTH - 1),
      y: clamp(y, 0, Scene.LOGICAL_HEIGHT - 1),
    };
  }

  // Only for testing: which cells would hit right now?
  function debugAnswer() {
    return game.round ? answerCells().map(function (cell) { return cell.name; }) : [];
  }

  /* ----------------------------------------------------------
     8. SCOREBOARD (saved in this browser, one board per channel)
     ---------------------------------------------------------- */
  // Load saved scores, keeping only entries that look right (the saved
  // text could be old, hand-edited or broken).
  function loadScores(board) {
    const scores = Object.create(null);   // no built-in keys like "__proto__"
    try {
      const saved = JSON.parse(storageGet('scores.' + board));
      const players = saved && saved.players;
      if (!players || typeof players !== 'object') return scores;
      Object.keys(players).forEach(function (id) {
        const entry = players[id];
        if (entry && typeof entry.name === 'string' && Number.isFinite(entry.points) && entry.points > 0) {
          scores[id] = { name: entry.name.slice(0, 25), points: Math.floor(entry.points), at: Number(entry.at) || 0 };
        }
      });
    } catch (error) {
      // Broken data: start with an empty board.
    }
    return scores;
  }

  function saveScores() {
    if (!game.board) return;
    storageSet('scores.' + game.board, JSON.stringify({ version: 1, players: game.scores }));
  }

  // One point for this player. Returns their new total.
  function addPoint(player) {
    const entry = game.scores[player.id] || { name: player.name, points: 0, at: 0 };
    entry.name = player.name;   // keep the newest spelling of their name
    entry.points += 1;
    entry.at = Date.now();      // on a tie, whoever got there first ranks higher
    game.scores[player.id] = entry;
    saveScores();
    renderLeaderboard();
    return entry.points;
  }

  function topScores(count) {
    return Object.keys(game.scores)
      .map(function (id) { return game.scores[id]; })
      .sort(function (a, b) { return (b.points - a.points) || (a.at - b.at); })
      .slice(0, count);
  }

  function resetScores() {
    game.scores = Object.create(null);
    saveScores();
    renderLeaderboard();
    showNotice(TEXT.scoresReset);
  }

  // Switch to the scoreboard of this channel (or the offline one).
  function useScoreboard(board) {
    game.board = board;
    game.scores = loadScores(board);
    applyUrlReset(board);
    renderLeaderboard();
  }

  // ?reset=1 resets the board ONCE. The value is remembered, so an OBS
  // source that reloads the same address doesn't wipe it every time.
  // To reset again later, use a new value: ?reset=2, ?reset=3 ...
  function applyUrlReset(board) {
    const token = SETTINGS.resetToken;
    if (!token) return;
    const doneKey = 'resetDone.' + board;
    if (storageGet(doneKey) === token) return;
    resetScores();
    storageSet(doneKey, token);
    setUrlParam('reset', null);   // a normal browser tab also forgets it
    showNotice(TEXT.scoresResetFromUrl);
  }

  /* ----------------------------------------------------------
     9. ON-SCREEN TEXT
     textContent (never innerHTML) is used for everything a viewer
     typed, so a name like <b>hi</b> shows up as plain text.
     ---------------------------------------------------------- */
  // Only touch the page when the text really changes (the clock runs 4x a second).
  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  function renderRoundInfo() {
    const round = game.round;
    const lines = [format(TEXT.goal, { cryptid: round.forest.cryptid.name, example: Grid.EXAMPLE })];
    lines.push(format(TEXT.guessesEach, { count: SETTINGS.guessesPerRound }));
    if (round.hint) {
      lines.push(format(TEXT.hint, {
        first: Grid.columnLetter(round.hint.first),
        last: Grid.columnLetter(round.hint.last),
      }));
    }
    setText(el.hint, lines.join('\n'));
  }

  function renderTimer() {
    const round = game.round;
    let text = TEXT.title;
    let look = '';
    if (game.state === STATE.ROUND_ACTIVE) {
      if (round.paused) {
        text = format(TEXT.paused, { number: round.number });
        look = 'is-paused';
      } else {
        text = format(TEXT.clock, { number: round.number, time: formatClock(round.remainingMs) });
        if (round.remainingMs <= LOW_TIME_SECONDS * 1000) look = 'is-low';
      }
    } else if (isRevealing()) {
      const seconds = Math.max(0, Math.ceil((round.revealEndsAt - performance.now()) / 1000));
      text = format(TEXT.nextRound, { seconds: seconds });
    } else if (game.state === STATE.CONNECTING) {
      text = TEXT.waitingForChat;
    }
    setText(el.timer, text);
    if (el.timer.className !== look) el.timer.className = look;
  }

  function showBanner(title, detail) {
    setText(el.bannerTitle, title);
    setText(el.bannerDetail, detail);
    el.banner.hidden = false;
  }

  function hideBanner() {
    el.banner.hidden = true;
  }

  function showNotice(text) {
    setText(el.notice, text);
    el.notice.hidden = false;
    clearTimeout(game.noticeTimer);
    game.noticeTimer = setTimeout(function () { el.notice.hidden = true; }, NOTICE_MS);
  }

  // kind: 'connecting', 'connected', 'retrying', 'warning', 'stopped' or 'offline'
  function setConnectionStatus(kind, text) {
    el.connection.className = 'status-' + kind;
    setText(el.connection, text);
  }

  // kind: 'miss', 'hit' or 'info'. Only the newest FEED_LENGTH are kept.
  function addToFeed(name, cellName, result, kind) {
    game.feed.push({ name: name, cell: cellName, result: result, kind: kind });
    if (game.feed.length > FEED_LENGTH) game.feed.shift();
    renderFeed();
  }

  function renderFeed() {
    el.feed.textContent = '';
    game.feed.forEach(function (entry) {
      const line = document.createElement('li');
      line.className = 'feed-' + entry.kind;
      line.appendChild(makeSpan('feed-name', entry.name));
      line.appendChild(makeSpan('feed-cell', entry.cell));
      line.appendChild(makeSpan('feed-result', entry.result));
      el.feed.appendChild(line);
    });
  }

  function renderLeaderboard() {
    el.scoreList.textContent = '';
    const top = topScores(LEADERBOARD_SIZE);
    if (top.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'score-empty';
      empty.textContent = TEXT.noFinds;
      el.scoreList.appendChild(empty);
      return;
    }
    top.forEach(function (entry, index) {
      const line = document.createElement('li');
      line.appendChild(makeSpan('score-rank', (index + 1) + '.'));
      line.appendChild(makeSpan('score-name', entry.name));
      line.appendChild(makeSpan('score-points', String(entry.points)));
      el.scoreList.appendChild(line);
    });
  }

  function makeSpan(className, text) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  /* ----------------------------------------------------------
     10. CHANNEL AND TWITCH
     ---------------------------------------------------------- */
  function showChannelForm(errorText) {
    setState(STATE.NEED_CHANNEL);
    el.channelForm.hidden = false;
    setText(el.channelError, errorText || '');
    if (!el.channelInput.value) el.channelInput.value = storageGet('lastChannel') || '';   // a suggestion only
    setText(el.hint, TEXT.enterChannel);
    setConnectionStatus('offline', TEXT.notConnected);
    renderTimer();
    el.channelInput.focus();
  }

  function handleChannelSubmit(event) {
    event.preventDefault();   // stop the browser reloading the page
    const name = Twitch.cleanChannelName(el.channelInput.value);
    if (!name) {
      setText(el.channelError, TEXT.badChannelName);
      return;
    }
    el.channelForm.hidden = true;
    el.channelInput.blur();   // so the N / R / X / G / C keys work straight away
    setUrlParam('channel', name);
    storageSet('lastChannel', name);
    connectToChannel(name);
  }

  function connectToChannel(name) {
    game.usingChat = true;
    game.chatOnline = false;
    useScoreboard(name);
    setState(STATE.CONNECTING);
    renderTimer();
    Twitch.connect(name, {
      onStatus: handleChatStatus,
      onJoined: handleJoined,
      onChat: handleChatMessage,
    });
    if (SETTINGS.debug) startRound();   // debug: play right away, don't wait for Twitch
  }

  function handleChatStatus(kind, text) {
    setConnectionStatus(kind, text);
    if (kind === 'connecting' || kind === 'retrying' || kind === 'stopped') {
      game.chatOnline = false;
      if (shouldPause()) pauseRound();
    }
    if (game.state === STATE.CONNECTING) {
      // A misspelled channel never connects: say how to fix it.
      setText(el.hint, kind === 'warning' ? text + '\n' + TEXT.changeChannelTip : text);
    }
  }

  // The first join starts the first round. A rejoin after a dropped
  // connection just lets the paused round carry on.
  function handleJoined() {
    game.chatOnline = true;
    if (game.state === STATE.CONNECTING) startRound();
    else resumeRound();
  }

  function startOfflineMode() {
    game.usingChat = false;
    useScoreboard(OFFLINE_BOARD);
    setConnectionStatus('offline', TEXT.offline);
    startRound();
  }

  // Key C: stop reading chat and show the "Twitch channel" box again,
  // e.g. after a typo in the channel name. The typed-in name stays in
  // the box so it is easy to fix.
  function changeChannel() {
    if (game.state === STATE.NEED_CHANNEL) {
      el.channelInput.focus();
      return;
    }
    const oldChannel = game.usingChat ? game.board : '';
    game.usingChat = false;          // first, so stopping chat doesn't pause anything
    game.chatOnline = false;
    Twitch.disconnect();
    game.round = null;               // the clock ignores the game until a new round
    game.roundNumber = 0;
    game.feed = [];
    game.board = '';
    game.scores = Object.create(null);
    hideBanner();
    Grid.highlightColumns(null);
    renderFeed();
    renderLeaderboard();
    render();                        // the forest stays, without X marks
    setUrlParam('channel', null);    // so a reload asks again too
    el.channelInput.value = oldChannel;
    showChannelForm('');
  }

  /* ----------------------------------------------------------
     11. STREAMER KEYS AND THE DEBUG BOX
     ---------------------------------------------------------- */
  function handleKeyDown(event) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;   // typing in a box, not a shortcut
    const key = String(event.key || '').toLowerCase();
    // Stop the browser acting on our shortcut keys too. Without this,
    // C focuses the channel box and the same key press types a 'c' into it.
    if (['n', 'r', 'x', 'c', 'g'].indexOf(key) !== -1) event.preventDefault();
    if (key === 'n') newRound();
    else if (key === 'r') reveal();
    else if (key === 'x') handleResetKey();
    else if (key === 'c') changeChannel();
    else if (key === 'g') el.grid.hidden = !el.grid.hidden;   // grid lines can cross the cryptid
  }

  function newRound() {
    if (game.state === STATE.NEED_CHANNEL) {
      showNotice(TEXT.connectFirst);
      return;
    }
    startRound();
    if (game.round.paused) showNotice(TEXT.timerWaits);
  }

  function reveal() {
    endRound('revealed', null);   // does nothing unless a round is running
  }

  // Two presses, so one stray key can't wipe the board. (No confirm()
  // popup: OBS can't show those.)
  function handleResetKey() {
    if (!game.board) {
      showNotice(TEXT.connectFirst);
      return;
    }
    const now = performance.now();
    if (now - game.resetArmedAt <= RESET_CONFIRM_MS) {
      game.resetArmedAt = -Infinity;
      resetScores();
    } else {
      game.resetArmedAt = now;
      showNotice(TEXT.pressXAgain);
    }
  }

  // Type "alice: !spot C4" (or just "!spot C4") to pretend to be chat.
  function handleDebugSubmit(event) {
    event.preventDefault();
    const text = el.debugInput.value;
    const colon = text.indexOf(':');
    const name = colon > 0 ? text.slice(0, colon) : 'Tester';
    const message = colon > 0 ? text.slice(colon + 1) : text;
    showNotice(cleanName(name) + ': ' + handleChatGuess(name, message));
    el.debugInput.select();
  }

  /* ----------------------------------------------------------
     12. SCALING (from Step 1)
     Make the game box as big as the window allows while keeping 16:9,
     using only WHOLE-NUMBER scales so every logical pixel becomes an
     identical square. A 1920x1080 window or OBS source gives exactly 6x.
     ---------------------------------------------------------- */
  function fitCanvasToWindow() {
    // Windows display scaling (125%, 150%) makes one CSS pixel bigger
    // than one screen pixel, so the maths is done in screen pixels.
    // clientWidth/Height (not innerWidth/Height): on phones innerWidth can
    // stay too big after rotating, because the old, larger box overflowed.
    const dpr = window.devicePixelRatio || 1;
    const screenWidth = document.documentElement.clientWidth * dpr;
    const screenHeight = document.documentElement.clientHeight * dpr;

    const scale = Math.max(1, Math.floor(Math.min(
      screenWidth / Scene.LOGICAL_WIDTH,
      screenHeight / Scene.LOGICAL_HEIGHT
    )));

    el.game.style.width = (Scene.LOGICAL_WIDTH * scale / dpr) + 'px';
    el.game.style.height = (Scene.LOGICAL_HEIGHT * scale / dpr) + 'px';

    // Centre it, snapped to whole screen pixels (no half-pixel edges).
    const leftoverWidth = screenWidth - Scene.LOGICAL_WIDTH * scale;
    const leftoverHeight = screenHeight - Scene.LOGICAL_HEIGHT * scale;
    el.game.style.left = (Math.floor(leftoverWidth / 2) / dpr) + 'px';
    el.game.style.top = (Math.floor(leftoverHeight / 2) / dpr) + 'px';

    // Tell the CSS how big one logical pixel is, so text and grid scale too.
    el.game.style.setProperty('--px', (scale / dpr) + 'px');
  }

  /* ----------------------------------------------------------
     13. START
     ---------------------------------------------------------- */
  function findElements() {
    ['game', 'scene', 'grid', 'timer', 'hint', 'scoreList', 'banner', 'bannerTitle',
     'bannerDetail', 'notice', 'feed', 'connection', 'keyHelp', 'channelForm',
     'channelInput', 'channelError', 'debugForm', 'debugInput', 'debugInfo'].forEach(function (id) {
      el[id] = byId(id);
      if (!el[id]) throw new Error('index.html has no element with id="' + id + '"');
    });
    el.canvas = el.scene;
  }

  // Something broke before the game could start: say so ON SCREEN, since
  // beginners rarely open the console.
  function showFatalError(text) {
    const box = byId('hint');
    if (box) box.textContent = text;
    const banner = byId('banner');
    const title = byId('bannerTitle');
    if (banner && title) {
      title.textContent = text;
      banner.hidden = false;
    }
  }

  function boot() {
    findElements();
    ctx = el.canvas.getContext('2d');
    el.canvas.width = forestCanvas.width = Scene.LOGICAL_WIDTH;
    el.canvas.height = forestCanvas.height = Scene.LOGICAL_HEIGHT;
    el.canvas.addEventListener('click', handleCanvasClick);
    window.addEventListener('resize', fitCanvasToWindow);
    fitCanvasToWindow();

    const gridProblems = Grid.checkSettings();
    if (gridProblems.length > 0) {
      showFatalError(gridProblems[0]);
      return;
    }
    if (Scene.checkData() === 0) {
      showFatalError(TEXT.noCryptids);
      return;
    }

    el.game.style.setProperty('--cell', Grid.CELL_SIZE);   // style.css draws the grid lines
    Grid.buildLabels(el.grid);
    el.keyHelp.hidden = SETTINGS.inObs;   // keyboard help only in a normal browser
    el.debugForm.hidden = !SETTINGS.debug;
    el.channelForm.addEventListener('submit', handleChannelSubmit);
    el.debugForm.addEventListener('submit', handleDebugSubmit);
    window.addEventListener('keydown', handleKeyDown);

    // Something to look at before the first round (a different forest).
    bakeForest(Scene.generateRound(Math.floor(Math.random() * 4294967296), null));
    render();
    renderFeed();
    renderLeaderboard();

    const channel = Twitch.cleanChannelName(SETTINGS.rawChannel);
    if (channel) {
      connectToChannel(channel);
    } else if (SETTINGS.rawChannel) {
      showChannelForm(format(TEXT.notAChannel, { name: SETTINGS.rawChannel.slice(0, 40) }));
    } else if (SETTINGS.debug) {
      startOfflineMode();
    } else {
      showChannelForm('');
    }

    setInterval(tick, TICK_MS);   // the game clock: runs for the life of the page
  }

  try {
    boot();
  } catch (error) {
    console.error(error);
    showFatalError(TEXT.startFailed);
  }

  /* ----------------------------------------------------------
     14. SHARED (for the console and for testing)
     ---------------------------------------------------------- */
  return {
    STATE: STATE,
    handleChatGuess: handleChatGuess,
    newRound: newRound,
    reveal: reveal,
    resetScores: resetScores,
    changeChannel: changeChannel,
    debugAnswer: debugAnswer,
    getState: function () { return game.state; },
  };
})();
