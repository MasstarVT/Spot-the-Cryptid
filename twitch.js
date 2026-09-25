/* ==========================================================
   twitch.js  -  READS (never writes) one Twitch channel's chat

   Needs:  nothing.
   Shares: one object called Twitch:
     Twitch.connect(channel, handlers)  start (or restart) reading #channel
     Twitch.disconnect()                stop for good
     Twitch.cleanChannelName(text)      "#Name" or a twitch.tv link -> "name"
     Twitch.parseIrcLine(line)          turn one IRC line into data (tests)
   "handlers" is an object with any of these functions:
     onStatus(kind, text)  kind: 'connecting' | 'connected' | 'retrying'
                                 | 'warning' | 'stopped'
     onJoined()            we are in the channel; chat will arrive now
     onChat(message)       message = { name, userId, text }

   How it works: Twitch chat speaks IRC (an old, text-based chat
   protocol) over a WebSocket. We log in ANONYMOUSLY with the nickname
   "justinfan" + random digits. Twitch allows that for reading, with no
   password or token, and an anonymous user CANNOT post. So this game
   can never write in anyone's chat. Docs: https://dev.twitch.tv/docs/chat/irc/

   The conversation (> we send, < Twitch sends):
     > CAP REQ :twitch.tv/tags twitch.tv/commands   "add names and ids, please"
     > NICK justinfan48213                          (no PASS = anonymous)
     < :tmi.twitch.tv 001 justinfan48213 :Welcome, GLHF!
     > JOIN #somechannel
     < :justinfan48213!justinfan48213@... JOIN #somechannel
     < @display-name=Alice;user-id=123;... :alice!alice@... PRIVMSG #somechannel :!spot C4
     < PING :tmi.twitch.tv                          (every few minutes)
     > PONG :tmi.twitch.tv                          (answer, or Twitch hangs up)
   ========================================================== */
const Twitch = (function () {
  'use strict';

  /* ----------------------------------------------------------
     1. SETTINGS
     ---------------------------------------------------------- */
  const SERVER_URL = 'wss://irc-ws.chat.twitch.tv:443';

  // After a drop, wait 1 s, then 2 s, 4 s ... up to 30 s ("backoff"), so
  // a Twitch outage is not hammered. Resets once we are back in the chat.
  const FIRST_RETRY_DELAY_MS = 1000;
  const MAX_RETRY_DELAY_MS = 30000;
  // Plus a random extra bit, so many overlays don't all retry at once.
  const RETRY_JITTER_MS = 1000;

  // A connection can die without telling us (laptop sleep, Wi-Fi switch).
  // Every minute we PING Twitch; no answer within 15 s = reconnect.
  const KEEPALIVE_EVERY_MS = 60 * 1000;
  const KEEPALIVE_TIMEOUT_MS = 15 * 1000;

  // A misspelled channel is never confirmed. After this long we say so.
  const JOIN_WARNING_MS = 15 * 1000;

  // Twitch names: letters, digits and underscores, up to 25 long.
  // Checking this also stops anyone sneaking extra IRC commands in.
  const CHANNEL_NAME_PATTERN = /^[a-z0-9_]{1,25}$/;

  // Tag values escape a few characters (see the IRC docs): \s is a space...
  const TAG_ESCAPES = { ':': ';', 's': ' ', '\\': '\\', 'r': '\r', 'n': '\n' };

  // Control characters and text-direction tricks that could garble the
  // screen, removed from display names. Written as escapes on purpose
  // (the real characters are invisible, and some flip how a line of
  // code is displayed):
  //   \x00-\x1F, \x7F        control characters
  //   U+200E, U+200F         left-to-right / right-to-left marks
  //   U+202A - U+202E        direction embeddings and overrides
  //   U+2066 - U+2069        direction isolates
  const UNSAFE_NAME_CHARACTERS = /[\x00-\x1F\x7F\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

  // A reply starts with "@name " (the person being answered). It is
  // removed so "@bob !spot C4" still counts as a guess.
  const REPLY_PREFIX = /^@\S+\s+/;

  /* ----------------------------------------------------------
     2. STATE (one connection at a time)
     ---------------------------------------------------------- */
  let socket = null;        // the live WebSocket, or null
  let nick = '';            // our anonymous name, e.g. justinfan48213
  let channel = '';         // lower-case channel name, without the #
  let handlers = {};
  let running = false;      // false after disconnect(): don't reconnect
  let joined = false;
  let retryDelay = FIRST_RETRY_DELAY_MS;
  // Every timer has one named home and is cleared before it is set again.
  let retryTimer = null;
  let keepaliveTimer = null;   // setInterval: PING every minute
  let pongTimer = null;        // setTimeout: "no answer to our PING"
  let joinWarningTimer = null;

  /* ----------------------------------------------------------
     3. SMALL HELPERS
     ---------------------------------------------------------- */
  // "  #SomeChannel ", "@SomeChannel", "https://twitch.tv/SomeChannel?x"
  // or "twitch.tv/popout/SomeChannel/chat" -> "somechannel".
  // Returns '' when it can't be a Twitch name.
  function cleanChannelName(raw) {
    let name = String(raw || '').trim().toLowerCase();
    name = name.replace(/^.*?twitch\.tv\//, '');           // a pasted link
    name = name.replace(/^(popout|moderator)\//, '');      // pop-out chat links
    name = name.replace(/^[#@]+/, '');
    name = name.split(/[\/?#]/)[0];                        // drop "/chat" or "?tab=..."
    return CHANNEL_NAME_PATTERN.test(name) ? name : '';
  }

  // A bug in the game must never kill the chat connection, so every call
  // into the game is wrapped in try/catch.
  function call(handlerName, a, b) {
    const handler = handlers[handlerName];
    if (typeof handler !== 'function') return;
    try {
      handler(a, b);
    } catch (error) {
      console.error(error);
    }
  }

  function report(kind, text) {
    call('onStatus', kind, text);
  }

  // Returns true if the line was sent.
  function send(line) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(line + '\r\n');   // every IRC line ends with \r\n
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ----------------------------------------------------------
     4. CONNECTING AND RECONNECTING
     ---------------------------------------------------------- */
  // Returns false (and does nothing) for an impossible channel name.
  function connect(channelName, newHandlers) {
    const cleanName = cleanChannelName(channelName);
    if (!cleanName) return false;
    disconnect();
    channel = cleanName;
    handlers = newHandlers || {};
    running = true;
    retryDelay = FIRST_RETRY_DELAY_MS;
    openSocket();
    return true;
  }

  function disconnect() {
    const wasRunning = running;
    running = false;
    joined = false;
    clearTimers();
    dropSocket();
    if (wasRunning) report('stopped', 'Chat stopped');
  }

  function openSocket() {
    clearTimers();
    dropSocket();
    joined = false;
    nick = 'justinfan' + (10000 + Math.floor(Math.random() * 90000));
    report('connecting', 'Connecting to #' + channel + '...');
    try {
      socket = new WebSocket(SERVER_URL);
    } catch (error) {
      socket = null;
      scheduleReconnect('Could not open a connection');
      return;
    }
    socket.onopen = handleOpen;
    socket.onmessage = handleMessage;
    socket.onclose = handleClose;
    socket.onerror = function () { /* "close" always follows an error; we reconnect there */ };
  }

  // Forget the current socket. Its event handlers are removed FIRST, so a
  // late event from an old socket can never confuse the new one.
  function dropSocket() {
    if (!socket) return;
    const oldSocket = socket;
    socket = null;
    oldSocket.onopen = oldSocket.onmessage = oldSocket.onclose = oldSocket.onerror = null;
    try { oldSocket.close(); } catch (error) { /* it was already closed */ }
  }

  // quick: reconnect straight away (Twitch asked us to move servers).
  function scheduleReconnect(reason, quick) {
    clearTimeout(retryTimer);
    const delay = (quick ? 0 : retryDelay) + Math.floor(Math.random() * RETRY_JITTER_MS);
    report('retrying', reason + ' - retrying in ' + Math.max(1, Math.round(delay / 1000)) + 's');
    retryTimer = setTimeout(openSocket, delay);
    if (!quick) retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);   // wait longer next time
  }

  function reconnectNow(reason, quick) {
    clearTimers();
    dropSocket();
    joined = false;
    if (running) scheduleReconnect(reason, quick);
  }

  function clearTimers() {
    clearTimeout(retryTimer);
    clearInterval(keepaliveTimer);
    clearTimeout(pongTimer);
    clearTimeout(joinWarningTimer);
    retryTimer = keepaliveTimer = pongTimer = joinWarningTimer = null;
  }

  function startKeepalive() {
    clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(function () {
      if (!send('PING :spot-the-cryptid')) return;
      clearTimeout(pongTimer);
      pongTimer = setTimeout(function () {
        reconnectNow('Twitch stopped answering');
      }, KEEPALIVE_TIMEOUT_MS);
    }, KEEPALIVE_EVERY_MS);
  }

  function startJoinWarning() {
    clearTimeout(joinWarningTimer);
    joinWarningTimer = setTimeout(function () {
      if (!joined) report('warning', 'Still waiting for #' + channel + ' - is the name spelled right?');
    }, JOIN_WARNING_MS);
  }

  // Back online after a network drop: skip the rest of the wait.
  window.addEventListener('online', function () {
    if (running && !socket) openSocket();
  });

  /* ----------------------------------------------------------
     5. WEBSOCKET EVENTS
     ---------------------------------------------------------- */
  function handleOpen() {
    // Ask for tags (display names, user ids) and Twitch's own commands
    // (ROOMSTATE, NOTICE, RECONNECT). No PASS line = anonymous login.
    send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    send('NICK ' + nick);
    startKeepalive();
  }

  function handleMessage(event) {
    if (typeof event.data !== 'string') return;   // Twitch only sends text
    clearTimeout(pongTimer);                       // any line proves the connection is alive
    // One WebSocket message can hold several IRC lines. Each is handled
    // on its own, so one odd line can't stop the others.
    event.data.split('\r\n').forEach(function (line) {
      if (!line) return;
      try {
        handleLine(line);
      } catch (error) {
        console.warn('[Spot the Cryptid] Skipped a chat line:', line, error);
      }
    });
  }

  function handleClose() {
    socket = null;
    joined = false;
    clearTimers();
    if (running) scheduleReconnect('Chat connection lost');
  }

  /* ----------------------------------------------------------
     6. IRC LINES
     ---------------------------------------------------------- */
  function handleLine(line) {
    const message = parseIrcLine(line);
    switch (message.command) {
      case 'PING':      send('PONG :' + (message.trailing || 'tmi.twitch.tv')); break;  // "still there?"
      case '001':       send('JOIN #' + channel); startJoinWarning(); break;             // logged in: join
      case 'JOIN':      if (senderLogin(message) === nick) markJoined(); break;
      case 'ROOMSTATE': markJoined(); break;                                             // also means "joined"
      case 'PRIVMSG':   deliverChat(message); break;                                     // a chat message
      case 'NOTICE':    handleNotice(message); break;
      case 'RECONNECT': reconnectNow('Twitch is restarting a server', true); break;
      default:          break;   // PONG, CAP, 002-376 and friends: nothing to do
    }
  }

  function markJoined() {
    if (joined) return;   // ROOMSTATE also arrives when room settings change
    joined = true;
    retryDelay = FIRST_RETRY_DELAY_MS;
    clearTimeout(joinWarningTimer);
    report('connected', 'Connected to #' + channel);
    call('onJoined');
  }

  function deliverChat(message) {
    // Only messages for OUR channel (params[0] is "#channel").
    if ((message.params[0] || '').toLowerCase() !== '#' + channel) return;
    const login = senderLogin(message);
    const userId = message.tags['user-id'];
    let text = stripAction(message.trailing);
    if (message.tags['reply-parent-msg-id']) text = text.replace(REPLY_PREFIX, '');
    call('onChat', {
      name: cleanDisplayName(message.tags['display-name']) || login || 'someone',
      // user-id never changes, even when someone renames, so points
      // follow the person. The login is a fallback.
      userId: userId ? 'twitch:' + userId : 'login:' + login,
      text: text,
    });
  }

  function handleNotice(message) {
    if (message.tags['msg-id'] === 'msg_channel_suspended') {
      report('warning', '#' + channel + ' is suspended or does not exist');
    } else if (message.trailing) {
      report('warning', 'Twitch: ' + message.trailing);
    }
  }

  // ":ann!ann@ann.tmi.twitch.tv" -> "ann"
  function senderLogin(message) {
    return message.prefix.split('!')[0].toLowerCase();
  }

  // "/me waves" arrives wrapped as \x01ACTION waves\x01 (\x01 is an
  // invisible control character).
  function stripAction(text) {
    const match = /^\x01ACTION (.*?)\x01?$/.exec(text);
    return match ? match[1] : text;
  }

  function cleanDisplayName(name) {
    return String(name || '').replace(UNSAFE_NAME_CHARACTERS, '').trim().slice(0, 25);
  }

  // An IRC line looks like this (tags and prefix are optional):
  //   @display-name=Ann;user-id=123 :ann!ann@ann.tmi.twitch.tv PRIVMSG #chan :!spot C4
  //   '---------- tags -----------' '-------- prefix --------' command params trailing
  // A broken line comes back with command '' and is ignored.
  function parseIrcLine(line) {
    const message = { tags: Object.create(null), prefix: '', command: '', params: [], trailing: '' };
    let rest = String(line);

    if (rest.charAt(0) === '@') {
      const end = rest.indexOf(' ');
      if (end === -1) return message;
      message.tags = parseTags(rest.slice(1, end));
      rest = rest.slice(end + 1).replace(/^ +/, '');
    }
    if (rest.charAt(0) === ':') {
      const end = rest.indexOf(' ');
      if (end === -1) return message;
      message.prefix = rest.slice(1, end);
      rest = rest.slice(end + 1).replace(/^ +/, '');
    }
    const trailingStart = rest.indexOf(' :');
    if (trailingStart !== -1) {
      message.trailing = rest.slice(trailingStart + 2);
      rest = rest.slice(0, trailingStart);
    }
    const words = rest.split(' ').filter(Boolean);
    message.command = words.length > 0 ? words[0].toUpperCase() : '';
    message.params = words.slice(1);
    return message;
  }

  // "display-name=Ann;user-id=123" -> { 'display-name': 'Ann', 'user-id': '123' }
  function parseTags(text) {
    const tags = Object.create(null);   // no built-in keys, so odd tag names are harmless
    text.split(';').forEach(function (pair) {
      const equals = pair.indexOf('=');
      const key = equals === -1 ? pair : pair.slice(0, equals);
      const value = equals === -1 ? '' : pair.slice(equals + 1);
      if (key) tags[key] = unescapeTagValue(value);
    });
    return tags;
  }

  function unescapeTagValue(value) {
    return value.replace(/\\(.?)/g, function (match, letter) {
      return Object.prototype.hasOwnProperty.call(TAG_ESCAPES, letter) ? TAG_ESCAPES[letter] : letter;
    });
  }

  return {
    connect: connect,
    disconnect: disconnect,
    cleanChannelName: cleanChannelName,
    parseIrcLine: parseIrcLine,
  };
})();
