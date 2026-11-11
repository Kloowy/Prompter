# Prompter

Teleprompter that listens. Paste or open your speech, put the phone on the table, talk: the app highlights where you are (word, sentence, paragraph). Lost your place? Glance at the phone.

Plain HTML + CSS + vanilla JS, no build, no backend, installable PWA. Two speech engines: **on-device** (Vosk/WebAssembly, offline, restricted to the words of your script) and the browser's Web Speech API (Chrome, needs internet).

## Features
- Live position tracking by voice: survives skipped words/paragraphs, misheard words, repeated phrases (probabilistic tracker, see below)
- **On-device recognition**: ~0.4 s behind your voice instead of ~1 s, works offline, and because the recognizer may only "hear" words that are in your script it stays accurate with a foreign accent. Picked automatically when a model exists for the language, else the browser engine is used (setup screen: *Recognition*)
- **Settings** (gear in the top bar): text size, *Sync headings*, and **Jump sensitivity** (how readily the cursor leaps elsewhere when you skip; lower = trusts that you keep reading where you are). The **fast-forward button** in the top bar switches jumping off completely (cursor only creeps forward). Both are remembered.
- If you scroll away by hand and start reading somewhere else, tracking follows you there automatically (no need to press "Back to place")
- Open `.md` / `.txt` files (button or drag & drop), Markdown rendered nicely: headings, bold/italic, lists, tasks, quotes, code, tables
- Pinned chapter title at the top, one-tap prev/next chapter, chapter list
- Toggle (next to the pencil): does sync expect the headings to be spoken or not (they stay visible and pinned either way)
- In-app fuzzy search (Ctrl+F on desktop, magnifier on phone): typos, word endings, no diacritics, several keywords in any order
- Paragraph skip, manual scroll with "Back to place", wake lock, font size

## Where is what
| File | What it does |
|---|---|
| `index.html` | markup only: setup screen, reader screen, bars |
| `css/style.css` | all visuals (sections: setup, bars, text + highlight, markdown, search, chapters) |
| `js/ui.js` | small UI pieces: animated sliders with discrete steps (`makeSlider`) and pull-down bottom sheets (`sheetDrag`) |
| `js/track.js` | **the tracker**: a probabilistic model of "where in the script is the speaker" (`Tracker`) and the adapter that turns engine output into committed/tentative words (`SegFeed`) |
| `fonts/` | Onest variable font (Latin, Latin-ext, Cyrillic; SIL OFL, see `fonts/OFL-Onest.txt`) |
| `js/match.js` | word normalization and fuzzy word similarity (`csim`), script index helpers; also the old window matcher kept for tests |
| `js/engine-local.js` | on-device engine: model download/caching, microphone -> Vosk, grammar from your script |
| `js/mic-worklet.js` | audio-thread microphone chunker used by the on-device engine |
| `vendor/vosk.js` | vosk-browser 0.0.8 (Apache 2.0), Kaldi compiled to WebAssembly |
| `models/` | on-device models (`en-us.tar.gz` included; others via `tools/get-models.py`) |
| `tools/get-models.py` | `python3 tools/get-models.py de fr es` downloads more languages into `models/` |
| `js/markdown.js` | Markdown parser (blocks + inline), no DOM |
| `js/search.js` | fuzzy keyword search, no DOM |
| `js/app.js` | everything with a screen: building the text, highlight, mic, search UI, chapters, file loading |
| `sw.js` | service worker (offline UI). **Bump `CACHE` and update `FILES` when you add/rename files** |
| `manifest.webmanifest`, `icon-*.png` | PWA install |
| `tests/run.js` | `node tests/run.js` checks parser, search, tracker (no browser needed) |
| `tests/sim2.js` | simulates the BROWSER engine as it really behaves (delay, bursts, duplicate segments, silent list restarts, pauses, speed changes) and compares the previous cursor logic (`tests/legacy.js`) with the current one |
| `tests/sim.js` | `node tests/sim.js` simulates a speaker + noisy recognizer, compares old matcher and tracker |
| `tests/local.html` | developer page to try the on-device engine in isolation |

## Run locally
Any static server, e.g. `python3 -m http.server 8000`, then open `http://localhost:8000`. (Mic and service worker need `localhost` or https.)

## Deploy
- **GitHub Pages**: push this folder to a repo, Settings -> Pages -> Deploy from branch -> `main` / root.
- **Netlify**: drag & drop the folder.

Then open the URL in Chrome on Android -> menu -> Install app.

## How the tracking works
`js/track.js` keeps a probability for every word of the script (a hidden-Markov forward filter). Each recognized word moves the
belief: stay, +1 (normal), +2..+8 (words skipped), or a jump anywhere (jumps prefer sentence/paragraph starts and whatever is
visible on screen); how well the heard word resembles a script word weighs the options, with a floor so that a misheard word only
weakens the belief a bit. Finished utterances stay in the belief, only the tentative tail is recomputed per update. The cursor moves
when the belief is concentrated enough (`TRK.ACC_*`). In `tests/sim.js` (skips, jumps, repeats, 6-12 % substituted / 5-12 % lost
words, 0.8-1.1 s engine delay) compared with the previous window matcher: position within +-2 words 96.8 % vs 91.5 %, mean error
0.58 vs 1.70 words, median recovery after a jump about 1 s vs 2 s, failed recoveries 0 vs 5.

## On-device engine notes
- First start downloads the model (~32-46 MB) once and keeps it in Cache Storage; afterwards everything works offline.
- The recognizer is created with a grammar = all words of your script + `[unk]`. Words the model does not know (names, numbers) are ignored by the recognizer; the tracker simply skips them.
- Languages with a model file: en, de, fr, es, it, pt, tr. Others (ru, uk, pl, ro ...) use the browser engine.
- Third-party: vosk-browser and Vosk models are Apache 2.0.

## Design notes
- The text is the interface: paragraphs you already read fade the most, upcoming ones stay readable, the current sentence sits on a soft card, words already said in it dim, and the current word is the only filled shape.
- Rare actions live in the top bar (edit, search, jump toggle, settings), frequent ones in the dock (paragraph / chapter buttons and the big sync button with a live voice-level meter). Settings and chapters are bottom sheets. A thin progress line runs along the bottom of the top bar.
- One accent (lavender) means "you are here" or "on". Problems show as a readable notice above the dock.

## Cursor logic (js/track.js)
`Tracker` keeps a probability for every word of the script and says where you are; it also reports how well the heard words
**fit** what is expected and how much belief sits right around the cursor. `SegFeed` turns whatever the engine delivers into committed
words plus one tentative tail (it survives duplicate segments and result lists that restart; a suspected restart never re-counts old
segments). `Pilot` decides what the cursor does, based on **continuity**: words that fit around where you were move you on (also
catching up from far behind, whatever the jump settings), noise never moves the cursor, and only when the surroundings cannot explain the
words is a jump considered (jumps on, sure enough, confirmed by further words). A word that is just the next one of your sentence can
never move you away; nothing larger than 60 words happens without a confirmed jump. With jumps off, a tap-to-jump offer appears when the
recognizer clearly hears you elsewhere. The cursor is placed a fixed number of words (0-3, *Cursor lead*) ahead of the recognized word, never steps back while you read on, ignores a few words of backward revision from the engine, and glides over several words instead of leaping when the engine delivers them in a burst.
The browser engine is restarted until it really runs again; a watchdog revives a session that heard speech but delivered nothing for 5 s
(or showed no sign of life for 12 s). *Settings > Show what I hear* shows the last recognized words; *Diagnostics log* records
what the recognizer heard and what the cursor did (copy it when something misbehaves).
Tests: `node tests/run.js`, `node tests/sim.js`, `node tests/sim2.js` (see the table above).

## Controls worth knowing
- **Settings** (gear): text size, *Text width* (computer screens only, default 780 px), *Sync headings*, *Jump sensitivity* (11 positions: 2 very careful, 2 careful, 3 balanced, 2 eager, 2 very eager), *Cursor lead*, diagnostics log. Sheets (settings, chapters) close by pulling them down by the handle or the header, with a finger or the mouse.
- **Mouse**: drag the text with the left button to scroll it (it glides a little after release); a click without moving jumps the cursor to that word.
- When you touch the screen while the view is still gliding to the cursor, that animation is cancelled at once.
- The progress line counts only words that are actually said: headings do not move it while *Sync headings* is off.

- **Sentence mode** (Settings): no word highlight; the current sentence sits on a card, the other sentences of the paragraph dim. Follows whole sentences, so word-level jitter is invisible.
