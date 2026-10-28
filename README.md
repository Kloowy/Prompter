# Prompter

Teleprompter that listens. Paste or open your speech, put the phone on the table, talk: the app highlights where you are (word, sentence, paragraph). Lost your place? Glance at the phone.

Plain HTML + CSS + vanilla JS, no build, no backend, installable PWA. Two speech engines: **on-device** (Vosk/WebAssembly, offline, restricted to the words of your script) and the browser's Web Speech API (Chrome, needs internet).

## Features
- Live position tracking by voice: survives skipped words/paragraphs, misheard words, repeated phrases (probabilistic tracker, see below)
- **On-device recognition**: ~0.4 s behind your voice instead of ~1 s, works offline, and because the recognizer may only "hear" words that are in your script it stays accurate with a foreign accent. Picked automatically when a model exists for the language, else the browser engine is used (setup screen: *Recognition*)
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
| `js/track.js` | **the tracker**: a probabilistic model of "where in the script is the speaker" (`Tracker`) and the adapter that turns engine output into committed/tentative words (`SegFeed`) |
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
