// Validation: Ajv schema checks (same options as Yomitan's dev validator)
// plus structural checks (index-in-root, version, media references).
// All schemas are the verbatim vendored copies in src/vendor/schemas/.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {BANK_TYPES, INDEX_FILE, STYLES_FILE, classifyBankFile} from './constants.js';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vendor', 'schemas');

const SCHEMA_FILES = {
  index: 'dictionary-index-schema.json',
  termBankV1: 'dictionary-term-bank-v1-schema.json',
  termBankV3: 'dictionary-term-bank-v3-schema.json',
  termMetaBankV3: 'dictionary-term-meta-bank-v3-schema.json',
  kanjiBankV1: 'dictionary-kanji-bank-v1-schema.json',
  kanjiBankV3: 'dictionary-kanji-bank-v3-schema.json',
  kanjiMetaBankV3: 'dictionary-kanji-meta-bank-v3-schema.json',
  tagBankV3: 'dictionary-tag-bank-v3-schema.json',
};

/** @type {Map<string, import('ajv').ValidateFunction>|null} */
let _validators = null;

function readSchemaFile(name) {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, name), 'utf8'));
}

/** Compile once per process; same Ajv options as dev/schema-validate.js. */
export function getValidators() {
  if (_validators) { return _validators; }
  const ajv = new Ajv({meta: false, strictTuples: false, allowUnionTypes: true});
  try {
    const metaPath = fileURLToPath(import.meta.resolve('ajv/dist/refs/json-schema-draft-07.json'));
    ajv.addMetaSchema(JSON.parse(readFileSync(metaPath, 'utf8')));
  } catch {
    // Ajv ships draft-07 support by default; manual registration is only
    // needed to mirror upstream exactly. Continue without it.
  }
  _validators = new Map();
  for (const [key, file] of Object.entries(SCHEMA_FILES)) {
    _validators.set(key, ajv.compile(readSchemaFile(file)));
  }
  return _validators;
}

/** @param {object} index parsed index.json */
export function detectVersion(index) {
  const v = index.format ?? index.version;
  return typeof v === 'number' ? v : null;
}

/** @returns {string|null} schema key for a bank type at a dictionary version */
export function schemaKeyFor(bankType, version) {
  const t = BANK_TYPES[bankType];
  if (!t) { return null; }
  if (version === 1 && t.schemaV1) { return t.schemaV1; }
  return t.schemaV3;
}

/**
 * Validate a whole bank array. Returns {ok, errors} with Ajv errors trimmed.
 * @param {string} schemaKey
 * @param {unknown} data
 */
export function validateAgainst(schemaKey, data) {
  const fn = getValidators().get(schemaKey);
  if (!fn) { throw new Error(`Unknown schema: ${schemaKey}`); }
  const ok = fn(data);
  if (ok) { return {ok: true, errors: []}; }
  return {ok: false, errors: summarizeAjvErrors(fn.errors ?? [])};
}

/**
 * Validate a SINGLE bank entry by wrapping it in a one-element array,
 * since bank schemas describe arrays of entries.
 */
export function validateSingleEntry(bankType, entry, version) {
  const key = schemaKeyFor(bankType, version);
  if (!key) { throw new Error(`Unknown bank type: ${bankType}`); }
  return validateAgainst(key, [entry]);
}

/**
 * Assert a plain object is a valid index.json (schema + non-empty title/revision).
 * @param {unknown} obj
 * @returns {object} the same object, typed as index
 * @throws {Error} when invalid
 */
export function assertValidIndex(obj) {
  const check = validateAgainst('index', obj);
  if (!check.ok) {
    throw new Error(`Invalid index.json: ${JSON.stringify(check.errors)}`);
  }
  if (typeof obj.title !== 'string' || obj.title === '' || typeof obj.revision !== 'string' || obj.revision === '') {
    throw new Error('Invalid index.json: title and revision must be non-empty strings');
  }
  return obj;
}

/** Keep error payloads small and JSON-safe for agent consumption. */
function summarizeAjvErrors(errors) {
  const first = errors.slice(0, 3).map((e) => ({
    instancePath: e.instancePath,
    keyword: e.keyword,
    message: e.message,
    params: e.params,
  }));
  return {count: errors.length, first};
}

/**
 * Full dictionary validation (staged overlay included, so agents can
 * validate before save).
 * @param {import('./store.js').Store} store
 * @returns {Promise<{valid:boolean, version:number|null, errors:Array, warnings:Array}>}
 */
export async function validateDictionary(store) {
  const errors = [];
  const warnings = [];
  const files = await store.listFiles();
  const fileSet = new Set(files);

  // --- index.json must be in the root (mirror DictionaryImporter) ---
  if (!fileSet.has(INDEX_FILE)) {
    const nested = files.filter((f) => f === INDEX_FILE || f.endsWith(`/${INDEX_FILE}`));
    if (nested.length > 0) {
      errors.push({file: INDEX_FILE, message: `Dictionary index found nested (${nested[0]}) but must be in the archive root`});
    } else {
      errors.push({file: INDEX_FILE, message: 'No dictionary index found in archive'});
    }
    return {valid: false, version: null, errors, warnings};
  }

  let index;
  try {
    index = await store.readJson(INDEX_FILE);
  } catch (e) {
    errors.push({file: INDEX_FILE, message: e.message});
    return {valid: false, version: null, errors, warnings};
  }

  const indexCheck = validateAgainst('index', index);
  if (!indexCheck.ok) {
    errors.push({file: INDEX_FILE, message: 'index.json failed schema validation', details: indexCheck.errors});
  }
  if (typeof index.title !== 'string' || index.title === '' || typeof index.revision !== 'string' || index.revision === '') {
    errors.push({file: INDEX_FILE, message: 'index.json requires non-empty title and revision'});
  }
  const version = detectVersion(index);
  if (version !== 1 && version !== 2 && version !== 3) {
    errors.push({file: INDEX_FILE, message: `Unrecognized dictionary format: ${JSON.stringify(index.format ?? index.version)}`});
    return {valid: false, version, errors, warnings};
  }

  // --- bank files ---
  /** bankType -> number[] for gap warnings */
  const seen = {term: [], termMeta: [], kanji: [], kanjiMeta: [], tag: []};
  for (const file of files) {
    const type = classifyBankFile(file);
    if (file.endsWith('.json') && file !== INDEX_FILE && !type) {
      warnings.push({file, message: 'Unknown JSON file; ignored by Yomitan importer'});
      continue;
    }
    if (!type) { continue; }
    const m = file.match(/_(\d+)\.json$/);
    if (m) { seen[type].push(Number.parseInt(m[1], 10)); }
    let data;
    try {
      data = await store.readJson(file);
    } catch (e) {
      errors.push({file, message: e.message});
      continue;
    }
    if (!Array.isArray(data)) {
      errors.push({file, message: 'Bank file must contain a JSON array'});
      continue;
    }
    const key = schemaKeyFor(type, version);
    const check = validateAgainst(key, data);
    if (!check.ok) {
      errors.push({file, message: `${file} failed ${key} schema validation`, details: check.errors});
    }
    if (type === 'term') {
      for (const e of collectMissingMedia(data, file)) {
        if (!fileSet.has(e.path)) {
          errors.push({file, entryIndex: e.entryIndex, message: `Missing media file: ${JSON.stringify(e.path)}`});
        }
      }
    }
  }

  // --- bank numbering gaps are only warnings (importer ignores gaps) ---
  for (const [type, nums] of Object.entries(seen)) {
    if (nums.length === 0) { continue; }
    nums.sort((a, b) => a - b);
    for (let expect = nums[0]; expect <= nums[nums.length - 1]; expect++) {
      if (!nums.includes(expect)) {
        warnings.push({file: `${BANK_TYPES[type].prefix}_*.json`, message: `Missing ${BANK_TYPES[type].prefix}_${expect}.json in numbering sequence`});
      }
    }
  }

  // --- styles.css (mirror importer: present-but-empty is an error) ---
  if (fileSet.has(STYLES_FILE)) {
    try {
      const css = (await store.readFile(STYLES_FILE)).toString('utf8');
      if (css.trim() === '') { errors.push({file: STYLES_FILE, message: 'styles.css is present but empty'}); }
    } catch (e) {
      errors.push({file: STYLES_FILE, message: e.message});
    }
  }

  return {valid: errors.length === 0, version, errors, warnings};
}

/**
 * Scan term entries for image paths (glossary {type:'image'} + structured
 * content {tag:'img'}), mirroring importer media requirements.
 * @param {Array} entries raw term bank array
 * @returns {Array<{entryIndex:number, path:string}>}
 */
function collectMissingMedia(entries, _file) {
  /** @type {Array<{entryIndex:number, path:string}>} */
  const out = [];
  entries.forEach((entry, entryIndex) => {
    if (!Array.isArray(entry)) { return; }
    const glossary = entry.length >= 8 ? entry[5] : entry.slice(5);
    if (!Array.isArray(glossary)) { return; }
    for (const g of glossary) {
      collectGlossaryMedia(g, entryIndex, out);
    }
  });
  return out;
}

/** @param {unknown} g */
function collectGlossaryMedia(g, entryIndex, out) {
  if (typeof g !== 'object' || g === null || Array.isArray(g)) { return; }
  if (g.type === 'image' && typeof g.path === 'string') {
    out.push({entryIndex, path: g.path});
  } else if (g.type === 'structured-content' && typeof g.content !== 'undefined') {
    collectStructuredMedia(g.content, entryIndex, out);
  }
}

/** @param {unknown} node */
function collectStructuredMedia(node, entryIndex, out) {
  if (typeof node === 'string' || typeof node !== 'object' || node === null) { return; }
  if (Array.isArray(node)) {
    for (const child of node) { collectStructuredMedia(child, entryIndex, out); }
    return;
  }
  if (node.tag === 'img' && typeof node.path === 'string') {
    out.push({entryIndex, path: node.path});
    return;
  }
  if (typeof node.content !== 'undefined') { collectStructuredMedia(node.content, entryIndex, out); }
}
