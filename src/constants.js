// Shared constants. Rules mirror ext/js/dictionary/dictionary-importer.js
// (_getArchiveFiles queryDetails + _getDataBankSchemas).

export const INDEX_FILE = 'index.json';
export const STYLES_FILE = 'styles.css';

export const BANK_PATTERNS = {
  term: /^term_bank_(\d+)\.json$/,
  termMeta: /^term_meta_bank_(\d+)\.json$/,
  kanji: /^kanji_bank_(\d+)\.json$/,
  kanjiMeta: /^kanji_meta_bank_(\d+)\.json$/,
  tag: /^tag_bank_(\d+)\.json$/,
};

// bankType -> { prefix, schemaKeyV1?, schemaKeyV3, entryKind }
export const BANK_TYPES = {
  term: {prefix: 'term_bank', schemaV1: 'termBankV1', schemaV3: 'termBankV3'},
  termMeta: {prefix: 'term_meta_bank', schemaV3: 'termMetaBankV3'},
  kanji: {prefix: 'kanji_bank', schemaV1: 'kanjiBankV1', schemaV3: 'kanjiBankV3'},
  kanjiMeta: {prefix: 'kanji_meta_bank', schemaV3: 'kanjiMetaBankV3'},
  tag: {prefix: 'tag_bank', schemaV3: 'tagBankV3'},
};

export const SCHEMA_FILES = {
  index: 'dictionary-index-schema.json',
  termBankV1: 'dictionary-term-bank-v1-schema.json',
  termBankV3: 'dictionary-term-bank-v3-schema.json',
  termMetaBankV3: 'dictionary-term-meta-bank-v3-schema.json',
  kanjiBankV1: 'dictionary-kanji-bank-v1-schema.json',
  kanjiBankV3: 'dictionary-kanji-bank-v3-schema.json',
  kanjiMetaBankV3: 'dictionary-kanji-meta-bank-v3-schema.json',
  tagBankV3: 'dictionary-tag-bank-v3-schema.json',
};

/** Numeric suffix in `prefix_N.json`, or null when it does not match. */
export function bankNumber(bankType, filename) {
  const m = BANK_PATTERNS[bankType].exec(filename);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** 'term' | 'termMeta' | 'kanji' | 'kanjiMeta' | 'tag' | null */
export function classifyBankFile(filename) {
  for (const type of Object.keys(BANK_PATTERNS)) {
    if (BANK_PATTERNS[type].test(filename)) { return type; }
  }
  return null;
}

/**
 * Tuple positions for raw bank entries (positional arrays, NOT objects).
 * Term v1 has 5 fixed items + N glossary strings; term v3 has exactly 8.
 */
export const TERM_V3 = {
  EXPRESSION: 0, READING: 1, DEFINITION_TAGS: 2, RULES: 3,
  SCORE: 4, GLOSSARY: 5, SEQUENCE: 6, TERM_TAGS: 7,
};
export const KANJI_V3 = {
  CHARACTER: 0, ONYOMI: 1, KUNYOMI: 2, TAGS: 3, MEANINGS: 4, STATS: 5,
};
export const TAG_POS = {NAME: 0, CATEGORY: 1, ORDER: 2, NOTES: 3, SCORE: 4};

/** Yomitan treats empty reading as "same as expression" (importer normalizes). */
export function effectiveReading(expression, reading) {
  return reading && reading.length > 0 ? reading : expression;
}

/** Split a space-separated tag string; "" -> []. */
export function splitTags(s) {
  if (s === null || typeof s === 'undefined') { return []; }
  const t = String(s).trim();
  return t === '' ? [] : t.split(/\s+/);
}
