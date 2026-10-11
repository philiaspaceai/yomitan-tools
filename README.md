# yomitan-tools

[![npm version](https://img.shields.io/npm/v/yomitan-tools)](https://www.npmjs.com/package/yomitan-tools)

Universal Node.js library for working with **Yomitan dictionaries** — the
dictionary format behind the Yomitan Japanese pop-up dictionary extension
(JMdict, JMnedict, KANJIDIC-based, monolingual kokugo dictionaries like
Sanseido and Oubunsha, Jitendex, and 100+ more). Built for **AI agents and
LLM-powered tools**: search, read, edit, add, delete, and validate any
Yomitan dictionary (`.zip` or extracted folder), and render entries to
human-readable **Markdown**.

- 🔍 Search terms, kanji, frequency/pitch metadata and tags (streaming — safe on 600MB+ dictionaries)
- ✏️ Add, update and delete entries with schema-checked, atomic saves
- ✅ Validate like Yomitan itself (Ajv + structural + media-reference checks)
- 📝 Render any entry to Markdown with pitch accent, frequency and tag notes resolved

```sh
npm install yomitan-tools
```


The tool is driven purely by Yomitan's official schemas + importer rules
(vendored under `src/vendor/`, see `THIRD_PARTY_NOTES.md`), so it works on
all hundreds of Yomitan dictionaries in the wild — any language, v1/v2/v3,
tiny or 600MB+.

## Install

Node >= 22.

```sh
npm install
```

Runtime dependencies (same ones Yomitan itself uses): `ajv` (validation),
`@zip.js/zip.js` (archive I/O).

## Quick start

```js
import {openDictionary} from 'yomitan-tools'; // or './src/index.js'

const dict = await openDictionary('./my-dictionary.zip'); // .zip or folder
console.log(dict.title, dict.version); // e.g. 'JMnedict [2026-06-16]' 3

// Validate: schema + structural + media-reference checks.
console.log(await dict.validate());
// {valid: true, version: 3, errors: [], warnings: []}

// Search (streaming per bank file; safe on 600MB dictionaries).
const hits = await dict.searchTerms('打つ'); // exact match on expression/reading
// [{ref: {bankFile, bankType, entryIndex}, entry: [...]}, ...]

// Human-readable markdown for review.
console.log(await dict.render(hits[0].ref));

// Edit (staged until save; only the touched bank file is rewritten).
await dict.updateEntry(hits[0].ref, [...editedTuple]);
const ref = await dict.addEntry('term', ['新語', 'しんご', 'n', '', 0, ['neologism'], -1, '']);
await dict.deleteEntry(ref);
await dict.save(); // atomic (tmp + rename). Or: await dict.saveAs('copy.zip');

await dict.close();
```

## API

| Method | Purpose |
|---|---|
| `openDictionary(path)` | Open a `.zip` or extracted directory. |
| `listBanks()` | `{index, term[], termMeta[], kanji[], kanjiMeta[], tag[], styles, media[], others[]}` |
| `countEntries()` | Entry counts per bank type (reads everything; slow on huge dicts). |
| `getIndex()` / `setIndex(obj)` | Read / stage replacement `index.json` (schema-checked). |
| `getBank(file)` / `getEntry(ref)` | Raw bank array / single tuple by `{bankFile, entryIndex}`. |
| `searchTerms(q, opts)` | `match: exact\|prefix\|includes` (default `exact`), `limit` (default 50), `offset`, `bankFile`, `includeReading`. |
| `searchKanji / searchTermMeta / searchKanjiMeta / searchTags` | Same options over field `[0]`. |
| `addEntry(type, tuple, {targetBank?})` | Schema-checked; appends to highest-numbered bank by default. |
| `updateEntry(ref, tuple)` / `deleteEntry(ref)` | Schema-checked replace / remove. |
| `validate()` | Full check (see below). Includes staged changes, so validate *before* save. |
| `validateFile(file)` | Cheap single-file check — use for huge dictionaries. |
| `render(ref, {maxChars?})` | Entry → Markdown (tags, pitch, freq, IPA resolved automatically). |
| `renderRaw(type, tuple, opts)` | Same, without a ref. |
| `hasUnsavedChanges()` / `listStaged()` / `discard()` | Staging introspection. |
| `save()` / `saveAs(path)` | Persist atomically; `saveAs` never touches the original. |
| `close()` | Release the archive handle. |

Standalone pure functions are also exported: `renderTerm`, `renderKanji`,
`renderTag`, `renderMeta`, `renderEntry`, `validateDictionary`,
`validateSingleEntry`, `splitTags`, `effectiveReading`, `classifyBankFile`.

## Model

- **Refs are precise.** Every hit carries `{bankFile, bankType, entryIndex}` —
  pass it back to `get/update/delete/render`. No ambiguity across 200+ banks.
- **Staged mutations.** `add/update/delete/setIndex` only touch memory until
  `save()`. One bank file rewritten per change; everything else byte-identical.
- **Streaming search.** One bank file parsed at a time; stops once `limit` is
  hit. A rare-word lookup in a 600MB dictionary touches few files.
- **Lossy render.** Markdown keeps text structure (lists, tables, ruby as
  `漢字（かんじ）`, links, `![alt](media/path)`) and drops visual-only style.
  Images stay as path references — extract them separately if needed.

## Validation

Two layers, mirroring Yomitan's importer + dev validator:

1. **Ajv** over the vendored schemas (same options as upstream:
   `meta:false, strictTuples:false, allowUnionTypes:true`, draft-07).
2. **Structural**: `index.json` in root with `title`+`revision`, known
   `format|version`, glossary image paths resolve to real files,
   non-empty `styles.css`, bank numbering gaps (warnings only).

Full `validate()` on real dictionaries (measured):
jmnedict 3s · oubunsha 1s · sanseido 31s · jitendex 37s.
For huge dicts prefer `validateFile()` per touched bank.

Known upstream quirk: Yomitan's own **v1** term/kanji schemas declare
`maxItems: 5/4` alongside glossary `additionalItems`, so v1 entries *with*
definitions fail validation — under Yomitan's own validators too, not just
ours. Reading/searching/rendering such legacy data still works (handy for
migration); only `validate`/`add`/`update` refuse it, exactly like Yomitan.

## Tests

```sh
npm test  # node --test, no dev dependencies, self-contained fixtures
```

Covers: open (.zip + dir), search modes/pagination, all 6 official invalid
dictionaries rejected, add/update/delete round-trips in zip + dir,
`saveAs` isolation, markdown rendering of every structured-content tag,
v1 legacy shape.
