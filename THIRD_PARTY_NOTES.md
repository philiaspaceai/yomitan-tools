# Third-party notes

This tool vendors data files from the Yomitan project and follows the
behaviour of its dictionary importer/validator.

- Upstream: https://github.com/yomidevs/yomitan
- Source commit: `e7334a96106a6c74e6fa75bd33a5ea1219d92712`
- License: GPL-3.0-or-later (same as upstream; this package follows it;
  see root `LICENSE`)

No upstream checkout is needed in this repo: the `third_party/` reference
clone (if present locally) is git-ignored. Everything the package and its
tests need is vendored below.

## Vendored verbatim → `src/vendor/schemas/`

| Vendored file | Upstream source |
|---|---|
| `dictionary-index-schema.json` | `ext/data/schemas/dictionary-index-schema.json` |
| `dictionary-term-bank-v1-schema.json` | `ext/data/schemas/dictionary-term-bank-v1-schema.json` |
| `dictionary-term-bank-v3-schema.json` | `ext/data/schemas/dictionary-term-bank-v3-schema.json` |
| `dictionary-term-meta-bank-v3-schema.json` | `ext/data/schemas/dictionary-term-meta-bank-v3-schema.json` |
| `dictionary-kanji-bank-v1-schema.json` | `ext/data/schemas/dictionary-kanji-bank-v1-schema.json` |
| `dictionary-kanji-bank-v3-schema.json` | `ext/data/schemas/dictionary-kanji-bank-v3-schema.json` |
| `dictionary-kanji-meta-bank-v3-schema.json` | `ext/data/schemas/dictionary-kanji-meta-bank-v3-schema.json` |
| `dictionary-tag-bank-v3-schema.json` | `ext/data/schemas/dictionary-tag-bank-v3-schema.json` |

To re-vendor after updating the clone:

```sh
for f in dictionary-index-schema dictionary-term-bank-v1-schema \
  dictionary-term-bank-v3-schema dictionary-term-meta-bank-v3-schema \
  dictionary-kanji-bank-v1-schema dictionary-kanji-bank-v3-schema \
  dictionary-kanji-meta-bank-v3-schema dictionary-tag-bank-v3-schema; do
  cp "ext/data/schemas/$f.json" "src/vendor/schemas/$f.json"
done
# (run inside an upstream Yomitan checkout at the pinned commit above)
```

## Test fixtures (`test/fixtures/`, 208K, committed)

Copied verbatim from upstream `test/data/dictionaries/` at the same commit:
`valid-dictionary1` + `invalid-dictionary1..6`. They keep the suite
self-contained (no submodule, no downloads).

## Logic references (read, not copied)

- Bank filename patterns, `index.json`-in-root rule, v1/v3 branching,
  `reading: ""` means "same as expression", media-path resolution:
  `ext/js/dictionary/dictionary-importer.js`
- Official dev validation (Ajv options `meta:false, strictTuples:false,
  allowUnionTypes:true` + draft-07 meta schema, per-file validation):
  `dev/dictionary-validate.js`, `dev/schema-validate.js`,
  `dev/dictionary-archive-util.js`
- Structured-content traversal model for `render.js`:
  `ext/js/display/structured-content-generator.js`,
  `ext/js/templates/anki-template-renderer.js` (`_getStructuredContentText`)
- Type shapes for JSDoc: `types/ext/dictionary-data.d.ts`

## Deliberately NOT vendored

- `DictionaryImporter` class itself (needs IndexedDB/Dexie + browser
  workers + image decoders — wrong runtime for a Node.js agent tool).
- Template/Handlebars display pipeline (browser DOM rendering; `render.js`
  is a standalone markdown string builder instead).

## Known upstream quirk (v1 schemas)

`dictionary-term-bank-v1-schema.json` declares `maxItems: 5` together with
glossary `additionalItems`, and `dictionary-kanji-bank-v1-schema.json`
declares `maxItems: 4` together with meaning `additionalItems`. As a result,
v1 entries carrying definitions fail validation under BOTH of Yomitan's own
validators (Ajv with `strictTuples:false` and `ext/js/data/json-schema.js`;
verified empirically). This package reproduces that behaviour exactly rather
than diverging from upstream. See `test/validate.test.js`
("upstream v1 glossary quirk") and `README.md`.
