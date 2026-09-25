# Spot the Cryptid

A pixel-art hidden-object game for Twitch streams. Each round a cryptid
(Sasquatch, Mothman or Chupacabra) hides behind a tree in the back row of
a forest. Only a sliver of it peeks out: a dark shape and a pair of dull
eyes. Viewers guess where it is by typing a grid cell in chat, like
`!spot C4`. The first viewer to hit it scores a point, the cryptid is
revealed, and a new round starts with a new forest and a new hiding spot.

No install, no build step, no server: plain HTML, CSS and JavaScript that
runs straight from the folder.

## Run it

1. Double-click `index.html` (Chrome, Edge or Firefox).
2. Type your Twitch channel name in the box and press **Connect**.
   (Or open `index.html?channel=yourchannel` directly.)
3. When the bottom-right corner says **Connected to #yourchannel**, round 1
   starts. Tell chat to type `!spot` and a cell.

The game only **reads** chat. It logs in anonymously (no password, no
token, no Twitch account), so it cannot post anything in your chat. Every
hit, miss and winner is shown on screen.

## How chat plays (tell your viewers)

- The forest has a grid: columns **A-P** (letters along the top and
  bottom) and rows **1-9** (numbers down both sides).
- Type `!spot C4` to guess cell C4. Capitals and spaces don't matter:
  `!spot c4`, `!spot c 4`, `!spotc4`, `!spot C4!` and `!spot C4 by the oak`
  all work. Replies work too (`@someone !spot C4`).
- Each viewer has **3 guesses per round** and must wait **8 seconds**
  between guesses. A typo, or a cell someone already checked, costs
  nothing.
- A guess **hits** if the cell touches the part of the cryptid that peeks
  out (plus 1 pixel). So aim for its eyes: guessing the middle of every
  tree trunk usually misses.
- Missed cells get a red **X**, so chat can work together. The latest
  guesses are listed bottom left.
- Halfway through a round, a **hint** lights up four column letters.
- If nobody finds it in time it is revealed: "Nobody found the Mothman!",
  with the cells it was in.
- Tip: look for a pair of dull eyes in the dark band of forest behind the
  trees. Every oak in the back row has the same bush, so the bush is not
  a clue.

## URL settings

Add these after `index.html`, starting with `?` and joined with `&`,
for example `index.html?channel=yourchannel&round=90`.

| Setting | Example | What it does |
| --- | --- | --- |
| `channel` | `channel=yourchannel` | Which Twitch chat to read. There is no default: without it, the page asks. |
| `round` | `round=90` | Seconds per round (15 to 3600). Default 120. |
| `guesses` | `guesses=5` | Guesses per viewer per round (1 to 99). Default 3. |
| `bare` | `bare=1` | A message that is only a cell (`C4`) also counts. Off by default, because normal chat ("o7", "b4") looks like cells. Common ones like o7, b4, l8, a1, f1 and f2 never count. |
| `debug` | `debug=1` | Test mode: rounds start at once and a box lets you type pretend chat. Works without a channel. |
| `seed` | `seed=42` | The same forests every time (round 1 uses 42, round 2 uses 43...). For testing. |
| `reset` | `reset=1` | Clears the scoreboard ONCE (see Scoreboard). |

## Streamer keys

Click the game page first so it has keyboard focus (in OBS: right-click
the source and choose **Interact**). A plain click never makes a guess,
so this is safe during a round.

| Key | Action |
| --- | --- |
| `N` | Start a new round now (while still connecting, its timer waits for chat) |
| `R` | Reveal the cryptid and end this round |
| `X`, then `X` again within 3 s | Reset this channel's scoreboard |
| `G` | Hide / show the grid |
| `C` | Change channel: stop reading chat and show the channel box again |
| `Shift` + click | Test guess on the cell you clicked |

A **Shift+click** guess is credited as "Streamer". It uses exactly the
same rule as chat and can end the round, but never scores points. The key
help is shown bottom right in a normal browser and hidden inside OBS.

If chat disconnects, the round timer **pauses** ("PAUSED (chat offline)")
and carries on when chat is back, so nobody loses a round they could not
play. The game reconnects by itself.

## Scoreboard

- 1 point per find. The top 5 are shown top right.
- Scores are saved in the browser, one scoreboard per channel, so they
  survive reloads. They are kept by Twitch user ID, so a viewer who
  renames keeps their points.
- Reset with `X` twice, or add `&reset=1` to the address. The address
  reset happens only **once per value**, so an OBS source that reloads
  won't keep wiping the board. To reset again later, use `&reset=2`, then
  `&reset=3`, and so on.
- OBS keeps its own browser storage, separate from Chrome's, so OBS and a
  normal browser window have separate scoreboards.

## Add it to OBS

1. In your scene, add a **Browser** source.
2. **Untick "Local file"** (that option can't carry `?channel=...`).
3. In **URL**, type the file's address with your channel, for example:
   `file:///C:/Games/Spot%20the%20Cryptid/index.html?channel=yourchannel`
   (Tip: open `index.html` in Chrome, copy the address bar, and add
   `?channel=yourchannel` to the end. Spaces become `%20`.)
4. Set **Width 1920** and **Height 1080**. The pixel art is then exactly
   6x and perfectly sharp (1280x720 also works: exactly 4x).
5. Leave **"Shutdown source when not visible"** and **"Refresh browser
   when scene becomes active"** unticked, so rounds and the chat
   connection keep running when you switch scenes.
6. To use the keys: right-click the source, **Interact**, press them there.

If you keep "Local file" ticked instead, the channel box appears; type the
channel in the Interact window (it is pre-filled next time). You must
press Connect again **every time OBS starts**, so untick "Local file" to
avoid this.

## Test without Twitch

- Open `index.html?debug=1`. Rounds start at once. In the box at the top,
  type `alice: !spot C4` and press Enter, as if alice wrote it in chat.
  Offline scores go to a separate "(offline)" scoreboard.
- Add `&seed=42` to get the same forests every time.
- Press F12, open the **Console**, and try:
  - `Game.handleChatGuess('alice', '!spot C4')` returns `'miss'`, `'hit'`,
    `'cooldown'`, `'already-checked'`, `'no-guesses-left'`, `'bad-cell'`,
    `'not-a-guess'` or `'no-round'`. (Test guesses only score in offline
    mode, so they never land on a real channel's board.)
  - `Game.debugAnswer()` lists the cells that would hit (no peeking on stream!).
  - `Game.newRound()`, `Game.reveal()`, `Game.resetScores()`,
    `Game.changeChannel()`, `Game.getState()`.

## The files

`index.html` loads them in this order. Order matters: each file uses names
from the ones above it. They are plain `<script>` tags, not modules,
because browsers block module imports from `file://`.

| File | What is in it |
| --- | --- |
| `style.css` | How everything looks. All sizes scale with the pixel art. |
| `sprites.js` | All the pixel art and the list of cryptids. Pure data. |
| `scene.js` | Builds a new forest each round from a seed, checks it, draws it. |
| `grid.js` | Grid size, reading `!spot C4` from chat, the grid labels. |
| `twitch.js` | Reads Twitch chat (anonymous, read-only) and reconnects by itself. |
| `game.js` | Rounds, timer, guesses, scoreboard, screen text, keys. Starts the game. |

## Make it your own

- **Add a cryptid:** in `sprites.js`, copy a whole entry in `CRYPTIDS` and
  change the name, the 9-wide x 15-tall picture and the colours. You can
  use any letters, as long as each one has a colour in both `colors` and
  `foundColors`. The comment above `CRYPTIDS` explains which part peeks out
  (rows 2-7, columns 0-5: keep it dark, with one small tell like the
  eyes, clearly lighter than the body). Reload and open the console (F12):
  every cryptid is tested in the hiding spot at start-up, and one that
  would stick out, hide completely or hide its tell is left out, with a
  message naming the exact pixel. Eyes that are too faint get a warning.
- **Grid size:** `CELL_SIZE` at the top of `grid.js`. Any whole number
  from 13 up works. 20 (16x9 cells) fits the picture exactly; other sizes
  make the last column and row a bit thinner. Below 13 there would be
  more than 26 columns (A-Z), so the game shows an error instead.
- **Chat command:** `COMMAND` and `EXAMPLE` in `grid.js`.
- **Round length, guesses, cooldown, hint, messages:** the settings and
  the `TEXT` table at the top of `game.js`.
- **More or fewer trees and decoys:** the back-row settings near the top
  of `scene.js` (`DECOY_SPOTS`, `OAK_CHANCE`).

## How the hiding works

Every round the cryptid hides in exactly the arrangement that was checked
pixel by pixel in Step 1: the cryptid, then an oak drawn over it (leaves
over the top of its head, trunk over its right side), then a bush over its
legs. Only the oak's position changes. The back-row bush (`oakBush`) is
Step 1's bush with a slightly wider top, so nothing of the cryptid ever
sits on the lighter ground. Five decoy oak + bush groups are always
added, every other back-row oak gets the same bush at the same height,
and the other trees are placed beside the hiding spot, never on it.
Before a forest is shown, it is checked: nothing else may touch the
cryptid, only the strip beside the trunk may show (6 to 40 pixels), its
eyes must be visible, and that strip must sit in front of the dark far
forest. A forest that fails is rebuilt; if 40 in a row fail, the
hand-made forest from Step 1 is used.

## Troubleshooting

- **"Still waiting for #name - is the name spelled right?"** Twitch never
  confirmed the channel. Press **C** to change the channel and type it
  again (in OBS, use Interact first).
- **"Chat connection lost - retrying..."** The game reconnects by itself,
  waiting a little longer each time (up to 30 s). The round timer pauses.
- **Keys do nothing in OBS:** use **Interact** on the source first.
- **Clicking does not guess:** hold **Shift** while clicking.
- **Blurry pixels in OBS:** make sure the source is 1920x1080 (or
  1280x720) and not stretched in the scene.
- **A message on screen says something went wrong:** press F12 and read
  the Console; it names the file, sprite or row.
