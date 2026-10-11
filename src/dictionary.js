// High-level agent-facing API. One class, async methods, deterministic
// return shapes. All mutations are staged until save().
import {Store} from './store.js';
import {
  BANK_TYPES,
  INDEX_FILE,
  STYLES_FILE,
  classifyBankFile,
} from './constants.js';
import {detectVersion, schemaKeyFor, validateAgainst, validateDictionary, validateSingleEntry} from './validate.js';
import {renderEntry as renderRawEntry} from './render.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 5000;

/**
 * @typedef {{bankFile:string, bankType:'term'|'termMeta'|'kanji'|'kanjiMeta'|'tag', entryIndex:number}} EntryRef
 */

export class YomitanDictionary {
  /** Use openDictionary() instead. */
  constructor(store) {
    this._store = store;
    this._version = null;
    this._title = null;
  }

  get kind() { return this._store.kind; }
  get path() { return this._store.path; }
  get version() { return this._version; }
  get title() { return this._title; }

  async _refreshInfo() {
    try {
      const index = await this._store.readJson(INDEX_FILE);
      this._version = detectVersion(index);
      this._title = typeof index.title === 'string' ? index.title : null;
    } catch {
      this._version = null;
      this._title = null;
    }
  }

  /** @returns {Promise<{index:string|null, term:string[], termMeta:string[], kanji:string[], kanjiMeta:string[], tag:string[], styles:boolean, media:string[], others:string[]}>} */
  async listBanks() {
    const files = await this._store.listFiles();
    const out = {index: null, term: [], termMeta: [], kanji: [], kanjiMeta: [], tag: [], styles: false, media: [], others: []};
    for (const f of files) {
      if (f === INDEX_FILE) { out.index = f; continue; }
      if (f === STYLES_FILE) { out.styles = true; continue; }
      const t = classifyBankFile(f);
      if (t) { out[t].push(f); continue; }
      if (f.endsWith('.json')) { out.others.push(f); continue; }
      out.media.push(f);
    }
    return out;
  }

  /** Count entries per bank type (reads every bank; can be slow on huge dicts). */
  async countEntries() {
    const banks = await this.listBanks();
    const counts = {term: 0, termMeta: 0, kanji: 0, kanjiMeta: 0, tag: 0, total: 0};
    for (const type of Object.keys(counts).filter((k) => k !== 'total')) {
      for (const f of banks[type]) {
        counts[type] += (await this._store.readJson(f)).length;
      }
    }
    counts.total = counts.term + counts.termMeta + counts.kanji + counts.kanjiMeta + counts.tag;
    return counts;
  }

  // ---- index ----

  /** @returns {Promise<object>} parsed index.json */
  async getIndex() {
    return await this._store.readJson(INDEX_FILE);
  }

  /** Stage a replacement index.json (schema-checked). Does not save. */
  async setIndex(obj) {
    const {validateAgainst} = await import('./validate.js');
    const check = validateAgainst('index', obj);
    if (!check.ok) {
      throw new Error(`Invalid index.json: ${JSON.stringify(check.errors)}`);
    }
    if (typeof obj.title !== 'string' || obj.title === '' || typeof obj.revision !== 'string' || obj.revision === '') {
      throw new Error('Invalid index.json: title and revision must be non-empty strings');
    }
    this._store.stageJson(INDEX_FILE, obj);
    await this._refreshInfo();
    return await this.getIndex();
  }

  // ---- raw bank access ----

  /** @returns {Promise<unknown[]>} parsed bank array */
  async getBank(bankFile) {
    const data = await this._store.readJson(bankFile);
    if (!Array.isArray(data)) { throw new Error(`Bank file is not a JSON array: '${bankFile}'`); }
    return data;
  }

  /** @param {EntryRef} ref */
  async getEntry(ref) {
    const bank = await this.getBank(ref.bankFile);
    if (!Number.isInteger(ref.entryIndex) || ref.entryIndex < 0 || ref.entryIndex >= bank.length) {
      throw new Error(`Entry index out of range: ${ref.entryIndex} in '${ref.bankFile}' (size ${bank.length})`);
    }
    return {ref: normalizeRef(ref), bankType: inferBankType(ref.bankFile), entry: bank[ref.entryIndex]};
  }

  // ---- search ----

  /**
   * Search term banks by expression/reading.
   * @param {string} query
   * @param {{match?:'exact'|'prefix'|'includes', limit?:number, offset?:number, bankFile?:string, includeReading?:boolean}} [opts]
   * @returns {Promise<Array<{ref:EntryRef, entry:unknown[]}>>}
   */
  async searchTerms(query, opts = {}) {
    const {match = 'exact', limit = DEFAULT_LIMIT, offset = 0, bankFile = null, includeReading = true} = opts;
    const test = makeMatcher(match, query);
    const banks = bankFile ? [bankFile] : (await this.listBanks()).term;
    const out = [];
    let skipped = 0;
    for (const file of banks) {
      const data = await this.getBank(file);
      for (let i = 0; i < data.length; i++) {
        const e = data[i];
        if (!Array.isArray(e)) { continue; }
        const expr = String(e[0] ?? '');
        const reading = String(e[1] ?? '');
        const eff = reading !== '' ? reading : expr;
        if (!(test(expr) || (includeReading && test(eff)))) { continue; }
        if (skipped < offset) { skipped++; continue; }
        out.push({ref: {bankFile: file, bankType: 'term', entryIndex: i}, entry: e});
        if (out.length >= Math.min(limit, MAX_LIMIT)) { return out; }
      }
    }
    return out;
  }

  /**
   * Search kanji banks by character.
   * @param {string} query
   * @param {{match?:'exact'|'prefix'|'includes', limit?:number, offset?:number, bankFile?:string}} [opts]
   */
  async searchKanji(query, opts = {}) {
    return await this._searchSingleField('kanji', 0, query, opts);
  }

  /** Search term_meta banks by head expression. */
  async searchTermMeta(query, opts = {}) {
    return await this._searchSingleField('termMeta', 0, query, opts);
  }

  /** Search kanji_meta banks by character. */
  async searchKanjiMeta(query, opts = {}) {
    return await this._searchSingleField('kanjiMeta', 0, query, opts);
  }

  /** Search tag banks by tag name. */
  async searchTags(query, opts = {}) {
    return await this._searchSingleField('tag', 0, query, opts);
  }

  /** @private */
  async _searchSingleField(bankType, field, query, opts = {}) {
    const {match = 'exact', limit = DEFAULT_LIMIT, offset = 0, bankFile = null} = opts;
    const test = makeMatcher(match, query);
    const banks = bankFile ? [bankFile] : (await this.listBanks())[bankType];
    const out = [];
    let skipped = 0;
    for (const file of banks) {
      const data = await this.getBank(file);
      for (let i = 0; i < data.length; i++) {
        const e = data[i];
        if (!Array.isArray(e)) { continue; }
        if (!test(String(e[field] ?? ''))) { continue; }
        if (skipped < offset) { skipped++; continue; }
        out.push({ref: {bankFile: file, bankType, entryIndex: i}, entry: e});
        if (out.length >= Math.min(limit, MAX_LIMIT)) { return out; }
      }
    }
    return out;
  }

  // ---- mutations (staged until save) ----

  /** @param {'term'|'termMeta'|'kanji'|'kanjiMeta'|'tag'} bankType @param {unknown[]} entry @param {{targetBank?:string}} [opts] @returns {Promise<EntryRef>} */
  async addEntry(bankType, entry, opts = {}) {
    this._requireVersion();
    if (!BANK_TYPES[bankType]) { throw new Error(`Unknown bank type: ${bankType}`); }
    if (!Array.isArray(entry)) { throw new Error('Bank entry must be an array tuple'); }
    const check = validateSingleEntry(bankType, entry, this._version);
    if (!check.ok) { throw new Error(`Invalid ${bankType} entry: ${JSON.stringify(check.errors)}`); }
    const target = opts.targetBank ?? await this._defaultTargetBank(bankType);
    if (classifyBankFile(target) !== bankType) {
      throw new Error(`targetBank '${target}' does not match bank type '${bankType}'`);
    }
    let bank = [];
    if (await this._store.exists(target)) {
      bank = await this.getBank(target);
    }
    bank = [...bank, entry];
    this._store.stageJson(target, bank);
    return {bankFile: target, bankType, entryIndex: bank.length - 1};
  }

  /** @param {EntryRef} ref @param {unknown[]} entry @returns {Promise<EntryRef>} */
  async updateEntry(ref, entry) {
    this._requireVersion();
    const bankType = ref.bankType ?? inferBankType(ref.bankFile);
    if (!Array.isArray(entry)) { throw new Error('Bank entry must be an array tuple'); }
    const check = validateSingleEntry(bankType, entry, this._version);
    if (!check.ok) { throw new Error(`Invalid ${bankType} entry: ${JSON.stringify(check.errors)}`); }
    const bank = await this.getBank(ref.bankFile);
    assertIndex(ref, bank.length);
    const next = bank.slice();
    next[ref.entryIndex] = entry;
    this._store.stageJson(ref.bankFile, next);
    return normalizeRef({...ref, bankType});
  }

  /** @param {EntryRef} ref @returns {Promise<void>} */
  async deleteEntry(ref) {
    const bank = await this.getBank(ref.bankFile);
    assertIndex(ref, bank.length);
    const next = bank.slice();
    next.splice(ref.entryIndex, 1);
    this._store.stageJson(ref.bankFile, next);
  }

  // ---- validate & render ----

  /** Full validation (includes staged changes). */
  async validate() {
    return await validateDictionary(this._store);
  }

  /**
   * Validate a single file (index.json or one bank). Cheap alternative to
   * full validate() for huge dictionaries.
   * @param {string} bankFile
   * @returns {Promise<{valid:boolean, file:string, errors:Array, warnings:Array}>}
   */
  async validateFile(bankFile) {
    const base = bankFile.split('/').pop();
    if (base === INDEX_FILE) {
      const data = await this._store.readJson(bankFile);
      const check = validateAgainst('index', data);
      const errors = check.ok ? [] : [{file: bankFile, message: 'index.json failed schema validation', details: check.errors}];
      return {valid: errors.length === 0, file: bankFile, errors, warnings: []};
    }
    const type = classifyBankFile(base);
    if (!type) { throw new Error(`Not a bank file: '${bankFile}'`); }
    this._requireVersion();
    const data = await this.getBank(bankFile);
    const check = validateAgainst(schemaKeyFor(type, this._version), data);
    const errors = check.ok ? [] : [{file: bankFile, message: `${bankFile} failed schema validation`, details: check.errors}];
    return {valid: errors.length === 0, file: bankFile, errors, warnings: []};
  }

  /**
   * Render one entry to Markdown.
   * @param {EntryRef} ref
   * @param {{maxChars?:number}} [opts]
   */
  async render(ref, opts = {}) {
    const {entry, bankType} = await this.getEntry(ref);
    const ctx = await this._renderContext(bankType, entry);
    return renderRawEntry(bankType, entry, {...ctx, ...opts});
  }

  /** Render a raw tuple without a ref (needs bankType). */
  async renderRaw(bankType, entry, opts = {}) {
    const ctx = await this._renderContext(bankType, entry);
    return renderRawEntry(bankType, entry, {...ctx, ...opts});
  }

  /** Gather tag notes + related meta rows for richer rendering. */
  async _renderContext(bankType, entry) {
    const ctx = {};
    try {
      const banks = await this.listBanks();
      if (banks.tag.length > 0) {
        const notes = new Map();
        for (const f of banks.tag) {
          for (const t of await this.getBank(f)) {
            if (Array.isArray(t) && typeof t[3] === 'string' && t[3] !== '' && !notes.has(t[0])) {
              notes.set(t[0], t[3]);
            }
          }
        }
        ctx.tagNotes = notes;
      }
      if (bankType === 'term' && Array.isArray(entry)) {
        const head = String(entry[0] ?? '');
        const reading = String(entry[1] ?? '');
        const eff = reading !== '' ? reading : head;
        const frequencies = [];
        const pitches = [];
        const ipa = [];
        for (const f of banks.termMeta) {
          for (const m of await this.getBank(f)) {
            if (!Array.isArray(m) || m[0] !== head) { continue; }
            if (m[1] === 'freq') { frequencies.push(metaFreqRow(m[2])); }
            else if (m[1] === 'pitch' && isObj(m[2])) {
              if (m[2].reading === eff || m[2].reading === reading || m[2].reading === head) {
                pitches.push({reading: m[2].reading, positions: (m[2].pitches ?? []).map((p) => p.position)});
              }
            } else if (m[1] === 'ipa' && isObj(m[2])) {
              for (const t of m[2].transcriptions ?? []) { ipa.push({reading: m[2].reading, ipa: t.ipa}); }
            }
          }
        }
        if (frequencies.length > 0) { ctx.frequencies = frequencies; }
        if (pitches.length > 0) { ctx.pitches = pitches; }
        if (ipa.length > 0) { ctx.ipa = ipa; }
      }
      if (bankType === 'kanji' && Array.isArray(entry)) {
        const ch = String(entry[0] ?? '');
        const frequencies = [];
        for (const f of banks.kanjiMeta) {
          for (const m of await this.getBank(f)) {
            if (Array.isArray(m) && m[0] === ch && m[1] === 'freq') { frequencies.push(metaFreqRow(m[2])); }
          }
        }
        if (frequencies.length > 0) { ctx.frequencies = frequencies; }
      }
    } catch {
      // Rendering must never fail because of auxiliary data; core entry wins.
    }
    return ctx;
  }

  // ---- persist ----

  hasUnsavedChanges() {
    return this._store.hasUnsavedChanges();
  }

  /** Filenames with staged (unsaved) changes. */
  listStaged() {
    return [...this._store.staged.keys()].sort();
  }

  /** Drop staged changes. */
  discard() {
    this._store.discard();
  }

  /** Persist staged changes to the opened location. */
  async save() {
    await this._store.flush();
    await this._refreshInfo();
  }

  /**
   * Write the full image (original + staged) to a new location and continue
   * working there. Zip -> new .zip file; dir -> new directory.
   * @param {string} newPath
   */
  async saveAs(newPath) {
    const {promises: fs} = await import('node:fs');
    const target = (await import('node:path')).resolve(newPath);
    if (this._store.kind === 'zip') {
      if (!/\.zip$/i.test(target)) { throw new Error(`saveAs target must end with .zip: ${newPath}`); }
      await fs.mkdir((await import('node:path')).dirname(target), {recursive: true});
      // Repack straight to the target; the original file is never touched.
      await this._store._flushZip(target);
      this._store.staged.clear();
      const {Store: S} = await import('./store.js');
      await this._store.close();
      this._store = await S.open(target);
      await this._refreshInfo();
      return;
    }
    // dir -> dir: materialize overlay-resolved image at target
    await fs.mkdir(target, {recursive: true});
    for (const f of await this._store.listFiles()) {
      const data = await this._store.readFile(f);
      const full = (await import('node:path')).join(target, ...f.split('/'));
      await fs.mkdir((await import('node:path')).dirname(full), {recursive: true});
      await fs.writeFile(full, data);
    }
    const {Store: S2} = await import('./store.js');
    await this._store.close();
    this._store = await S2.open(target);
    this._store.staged.clear();
    await this._refreshInfo();
  }

  async close() {
    await this._store.close();
  }

  // ---- private ----

  _requireVersion() {
    if (this._version !== 1 && this._version !== 2 && this._version !== 3) {
      throw new Error('Cannot mutate: index.json is missing or has an unrecognized format/version; fix index.json first');
    }
  }

  /** @private */
  async _defaultTargetBank(bankType) {
    const banks = (await this.listBanks())[bankType];
    if (banks.length > 0) {
      const nums = banks.map((f) => Number.parseInt(f.match(/_(\d+)\.json$/)[1], 10));
      const max = Math.max(...nums);
      return `${BANK_TYPES[bankType].prefix}_${max}.json`;
    }
    return `${BANK_TYPES[bankType].prefix}_1.json`;
  }
}

/** @param {string} p */
export async function openDictionary(p) {
  const store = await Store.open(p);
  const dict = new YomitanDictionary(store);
  await dict._refreshInfo();
  return dict;
}

/** @param {EntryRef} ref @param {number} size */
function assertIndex(ref, size) {
  if (!Number.isInteger(ref.entryIndex) || ref.entryIndex < 0 || ref.entryIndex >= size) {
    throw new Error(`Entry index out of range: ${ref.entryIndex} in '${ref.bankFile}' (size ${size})`);
  }
}

/** @param {EntryRef} ref @returns {EntryRef} */
function normalizeRef(ref) {
  return {bankFile: ref.bankFile, bankType: ref.bankType ?? inferBankType(ref.bankFile), entryIndex: ref.entryIndex};
}

/** @param {string} bankFile */
function inferBankType(bankFile) {
  const t = classifyBankFile(bankFile.split('/').pop());
  if (!t) { throw new Error(`Cannot infer bank type from filename: '${bankFile}'`); }
  return t;
}

/** @param {'exact'|'prefix'|'includes'} mode @param {string} query */
function makeMatcher(mode, query) {
  if (typeof query !== 'string' || query === '') { throw new Error('Search query must be a non-empty string'); }
  switch (mode) {
    case 'exact': return (s) => s === query;
    case 'prefix': return (s) => s.startsWith(query);
    case 'includes': return (s) => s.includes(query);
    default: throw new Error(`Unknown match mode: ${mode} (use exact|prefix|includes)`);
  }
}

/** @param {unknown} v */
function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Normalize a freq cell to {frequency, displayValue}-ish for render. */
function metaFreqRow(data) {
  if (isObj(data) && ('frequency' in data || 'value' in data)) {
    const freq = data.frequency ?? data.value;
    const display = data.displayValue ?? (typeof data.reading === 'string' ? undefined : undefined);
    if (typeof data.reading === 'string') { return {frequency: freq, displayValue: display ?? freq, reading: data.reading}; }
    return {frequency: freq, displayValue: display ?? freq};
  }
  return {frequency: data, displayValue: data};
}
