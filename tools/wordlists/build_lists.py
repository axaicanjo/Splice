#!/usr/bin/env python3
"""Build Splice word lists.

Outputs (in this folder):
  accepted.txt     - every word a player may type (SCOWL size <=70, US English)
  puzzle.txt       - the ~20k most common accepted BASE words plus all their inflections
                     (start/target + par paths)
  puzzle_freq.tsv  - puzzle words with Zipf frequency; base rank, or the base an inflection came in with
  inflections.tsv  - accepted words that are -S/-ES, -ED or -ING forms (plus irregular
                     plurals/pasts), with their base word, for hub filtering later

Usage: python3 build_lists.py /path/to/scowl/final /path/to/agid/infl.txt
SCOWL source: https://github.com/en-wl/wordlist (tag rel-2020.12.07), built with `make`.
Requires: pip install wordfreq
"""
import re, sys, pathlib
from collections import defaultdict
from wordfreq import zipf_frequency

HERE = pathlib.Path(__file__).resolve().parent
SCOWL_FINAL = pathlib.Path(sys.argv[1])
AGID = pathlib.Path(sys.argv[2])

MIN_LEN = 4
MAX_SCOWL_SIZE = 70
PUZZLE_SIZE = 20000
INFL_MIN_ZIPF = 0.01   # inflections added on top must appear in the frequency data
CATEGORIES = ("english-words", "american-words")  # excludes proper names, abbreviations,
                                                  # contractions, capitalised words, UK variants
WORD_RE = re.compile(r"^[a-z]+$")                 # drops apostrophes, hyphens, accents, caps

def read_list(p):
    return {l.strip().lower() for l in open(p, encoding="utf-8")
            if l.strip() and not l.startswith("#")}

# ---- 1. raw accepted words from SCOWL ----
raw = set()
for f in SCOWL_FINAL.iterdir():
    cat, _, size = f.name.rpartition(".")
    if cat in CATEGORIES and size.isdigit() and int(size) <= MAX_SCOWL_SIZE:
        for w in open(f, encoding="latin-1"):
            w = w.strip()
            if len(w) >= MIN_LEN and WORD_RE.match(w):
                raw.add(w)

# ---- 2. inflection map from AGID ----
# line: "stop V: stopped, stoped!< 1 | stopping | stops"
# markers: ? questionable, ! not used, ~ variant, < = level; skip ? and ! forms
infl = defaultdict(lambda: {"bases": set(), "kinds": set()})
headwords = set()
SLOTS = {"N": ["plural"], "V3": ["past", "ing", "s"], "V4": ["past", "pp", "ing", "s"]}
for line in open(AGID, encoding="latin-1"):
    m = re.match(r"^(\S+) ([NVA])\??: (.*)$", line.strip())
    if not m:
        continue
    base, pos, rest = m.groups()
    headwords.add(base)
    if pos == "A":
        continue  # comparatives not tagged
    slots = rest.split(" | ")
    names = SLOTS["N"] if pos == "N" else SLOTS["V4" if len(slots) == 4 else "V3"]
    if len(slots) != len(names):
        continue
    for name, slot in zip(names, slots):
        for form in slot.split(", "):
            form = re.sub(r"\{.*?\}", "", form).strip()
            if "?" in form or "!" in form:
                continue
            form = re.split(r"[ ~<]", form)[0]
            if form and form != base and WORD_RE.match(form):
                kind = {"pp": "past", "s": "verb_s"}.get(name, name)
                infl[form]["bases"].add(base)
                infl[form]["kinds"].add(kind)

def stems(w):
    return {w} | infl[w]["bases"] if w in infl else {w}

# ---- 3. blocklists ----
slurs = read_list(HERE / "blocklists/slurs.txt")
puzzle_block = (read_list(HERE / "blocklists/puzzle_extra.txt")
                | {w for w in read_list(HERE / "sources/ldnoobw_en.txt") if " " not in w}
                | slurs)

accepted = sorted(w for w in raw if not (stems(w) & slurs))

# ---- 4. puzzle list: top PUZZLE_SIZE base words by frequency, plus their inflections ----
acc_set = set(accepted)
eligible = {w for w in accepted if not (stems(w) & puzzle_block)}
def is_base(w):
    # not an inflection, or also a word in its own right (CEILING, NEWS),
    # or its base is too short to be accepted (WENT <- go, RUNS <- run)
    return (w not in infl or w in headwords
            or not infl[w]["bases"] <= acc_set)
forms_of = defaultdict(set)
for w in eligible:
    for b in infl[w]["bases"] if w in infl else ():
        forms_of[b].add(w)
freq = {w: zipf_frequency(w, "en") for w in eligible}
bases = sorted((w for w in eligible if is_base(w) and freq[w] > 0),
               key=lambda w: (-freq[w], w))[:PUZZLE_SIZE]
base_rank = {w: i for i, w in enumerate(bases, 1)}
added = {}  # inflection -> base that brought it in (highest-ranked)
for b in bases:
    for f in sorted(forms_of[b]):
        if f not in base_rank and f not in added and freq[f] >= INFL_MIN_ZIPF:
            added[f] = b
puz_set = set(bases) | set(added)

# ---- 5. write ----
(HERE / "accepted.txt").write_text("\n".join(accepted) + "\n")
(HERE / "puzzle.txt").write_text("\n".join(sorted(puz_set)) + "\n")
with open(HERE / "puzzle_freq.tsv", "w") as f:
    f.write("word\tzipf\tbase_rank\tadded_via\n")
    for b in bases:
        f.write(f"{b}\t{freq[b]:.2f}\t{base_rank[b]}\t\n")
        for x in sorted(w for w, v in added.items() if v == b):
            f.write(f"{x}\t{freq[x]:.2f}\t\t{b}\n")
with open(HERE / "inflections.tsv", "w") as f:
    f.write("word\tbase\tkind\talso_headword\tin_puzzle\n")
    for w in accepted:
        if w in infl:
            wb = sorted(infl[w]["bases"])
            f.write(f"{w}\t{','.join(wb)}\t{','.join(sorted(infl[w]['kinds']))}\t"
                    f"{int(w in headwords)}\t{int(w in puz_set)}\n")

print(f"accepted: {len(accepted)}  (removed as slurs: {len(raw) - len(accepted)})")
print(f"puzzle:   {len(puz_set)}  = {len(bases)} base words (cutoff zipf {freq[bases[-1]]:.2f}) + {len(added)} inflections")
print(f"inflections tagged: {sum(1 for w in accepted if w in infl)}")
