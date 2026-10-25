# Splice

A daily word-chain game. Get from the start word to the target: each new word must begin with the last 2 or more letters of the previous word (3+ in hard mode). Fewest moves wins; ties go to the longest total overlap.

```
CARPET → PETAL (3) → TALON (3) → ONSET (2)   = 3 moves
```

## Features

- Daily puzzle (same for everyone, numbered from #1 on 25 Oct 2026, by local date)
- Practice mode (unlimited) and an archive of past dailies
- Hard mode (min overlap 3), set in Settings
- Hints: moves left / suggested next word (counted in the result)
- Par solution shown at the end; stats and streaks stored on the device
- Spoiler-free share text, e.g. `Splice #12 · 3·3·2 — par 3`
- 10 color themes in Settings

## Running locally

It's a static site with no build step. Serve the folder over HTTP (ES modules don't load from `file://`):

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Layout

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | the app (vanilla JS modules) |
| `js/solver.js` | rules + BFS solver, shared by the app (hints) and the generator |
| `js/themes.js` | the 10 color themes |
| `data/accepted.txt` | every word a player may enter (110,646) |
| `data/puzzle.txt` | common words used for start/target, par and hints (38,225) |
| `data/puzzles.json` | pregenerated daily (1,095) and practice (1,500) puzzles with par and a solution for normal and hard mode |
| `tools/generate_puzzles.mjs` | regenerates `data/puzzles.json` |
| `tools/wordlists/` | how the word lists were built, with the blocklists |

### Regenerating puzzles

```
node tools/generate_puzzles.mjs path/to/puzzle_freq.tsv path/to/inflections.tsv [nDaily] [nPractice]
```

Both TSVs are produced by `tools/wordlists/build_lists.py`. Puzzles use common base words of 5–7 letters for the start and target. Each has a normal par of 3–5 moves through common words, at least 3 distinct shortest solutions, and has a hard-mode par of at most 9.

## Word list credits

- **SCOWL** (Spell Checker Oriented Word Lists) by Kevin Atkinson, licensed under the terms in `tools/wordlists/sources/SCOWL-Copyright.txt`.
- **wordfreq** by Robyn Speer (word frequency ranking; data CC BY-SA 4.0).
- **List of Dirty, Naughty, Obscene, and Otherwise Bad Words** (LDNOOBW, CC BY 4.0), used only to exclude words from the puzzle list.
