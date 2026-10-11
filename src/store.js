// Low-level storage: one abstraction over a .zip archive or an extracted
// directory, plus staged (unsaved) changes. Reads check staged first.
// Keep this file dependency-free except zip.js + node builtins.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {
  BlobWriter,
  TextWriter,
  Uint8ArrayReader,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

/** @returns {string} absolute path */
function toAbs(p) {
  return path.resolve(p);
}

export class Store {
  /** Use Store.open() instead. */
  constructor(kind, absPath) {
    this.kind = kind; // 'zip' | 'dir'
    this.path = absPath;
    /** filename -> {op:'set', data:Buffer} | {op:'delete'} */
    this.staged = new Map();
    this._zipEntries = null; // Map<filename, Entry>, zip only
    this._zipReader = null;
    this._closed = false;
  }

  /** @param {string} p path to .zip file or directory */
  static async open(p) {
    const absPath = toAbs(p);
    const st = await fs.stat(absPath);
    if (st.isDirectory()) {
      return new Store('dir', absPath);
    }
    if (/\.zip$/i.test(absPath)) {
      const store = new Store('zip', absPath);
      await store._ensureZipLoaded();
      return store;
    }
    throw new Error(`Not a .zip file or directory: ${p}`);
  }

  /** @returns {boolean} */
  hasUnsavedChanges() {
    return this.staged.size > 0;
  }

  /** Discard staged changes without touching disk. */
  discard() {
    this.staged.clear();
  }

  async close() {
    if (this._zipReader) {
      try { await this._zipReader.close(); } catch { /* ignore */ }
      this._zipReader = null;
      this._zipEntries = null;
    }
    this._closed = true;
  }

  // ---- listing ----

  /** Filenames in the ORIGINAL backing (no staged overlay). */
  async listOriginal() {
    if (this.kind === 'dir') { return await this._listDirOriginal(); }
    await this._ensureZipLoaded();
    return [...this._zipEntries.keys()];
  }

  /** Filenames with staged overlay applied (deleted removed, new added). Sorted. */
  async listFiles() {
    const original = await this.listOriginal();
    const set = new Set(original);
    for (const [name, change] of this.staged) {
      if (change.op === 'delete') { set.delete(name); } else { set.add(name); }
    }
    return [...set].sort();
  }

  // ---- reading ----

  /** @returns {Promise<Buffer>} throws ENOENT-ish Error when missing */
  async readFile(filename) {
    const change = this.staged.get(filename);
    if (change) {
      if (change.op === 'delete') { throw missingError(filename); }
      return change.data;
    }
    return await this._readOriginal(filename);
  }

  /** @returns {Promise<boolean>} */
  async exists(filename) {
    try {
      await this.readFile(filename);
      return true;
    } catch {
      return false;
    }
  }

  /** Parse file as JSON (UTF-8). Error message includes filename. */
  async readJson(filename) {
    const buf = await this.readFile(filename);
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw new Error(`Invalid JSON in '${filename}': ${e.message}`);
    }
  }

  // ---- staging ----

  /** Stage a JSON-serializable value (bank files, index.json). */
  stageJson(filename, value) {
    this.staged.set(filename, {op: 'set', data: Buffer.from(JSON.stringify(value))});
  }

  /** Stage raw bytes (media, styles.css). */
  stageRaw(filename, data) {
    this.staged.set(filename, {op: 'set', data: Buffer.from(data)});
  }

  /** Stage a deletion. Throws if the file does not exist (overlay-aware). */
  async stageDelete(filename) {
    if (!await this.exists(filename)) { throw missingError(filename); }
    this.staged.set(filename, {op: 'delete'});
  }

  // ---- persist ----

  /**
   * Write staged changes to disk atomically, then clear staged.
   * Zip: full repack (tmp file + rename). Dir: per-file tmp + rename.
   */
  async flush() {
    if (this.staged.size === 0) { return; }
    if (this.kind === 'dir') { await this._flushDir(); } else { await this._flushZip(); }
    this.staged.clear();
  }

  // ---- internals: dir ----

  async _listDirOriginal() {
    /** @type {string[]} */
    const out = [];
    async function walk(dir, rel) {
      const entries = await fs.readdir(path.join(dir, rel), {withFileTypes: true});
      for (const e of entries) {
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { await walk(dir, relPath); } else if (e.isFile()) { out.push(relPath); }
      }
    }
    await walk(this.path, '');
    return out;
  }

  async _readOriginalDir(filename) {
    if (filename.includes('\\') || filename.startsWith('/') || filename.includes('..')) {
      throw new Error(`Unsafe filename: ${JSON.stringify(filename)}`);
    }
    try {
      return await fs.readFile(path.join(this.path, ...filename.split('/')));
    } catch (e) {
      throw missingError(filename);
    }
  }

  async _flushDir() {
    for (const [filename, change] of this.staged) {
      const full = path.join(this.path, ...filename.split('/'));
      if (change.op === 'delete') {
        await fs.rm(full, {force: true});
        continue;
      }
      await fs.mkdir(path.dirname(full), {recursive: true});
      const tmp = `${full}.${process.pid}.tmp`;
      await fs.writeFile(tmp, change.data);
      await fs.rename(tmp, full);
    }
  }

  // ---- internals: zip ----

  async _ensureZipLoaded() {
    if (this._zipEntries) { return; }
    const buf = await fs.readFile(this.path);
    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)));
    const entries = await reader.getEntries();
    const map = new Map();
    for (const e of entries) {
      if (e.filename.endsWith('/')) { continue; } // skip pure directory entries
      if (!map.has(e.filename)) { map.set(e.filename, e); }
    }
    this._zipReader = reader;
    this._zipEntries = map;
  }

  async _readOriginal(filename) {
    if (this.kind === 'dir') { return await this._readOriginalDir(filename); }
    await this._ensureZipLoaded();
    const entry = this._zipEntries.get(filename);
    if (!entry || typeof entry.getData !== 'function') { throw missingError(filename); }
    const blob = await entry.getData(new BlobWriter());
    return Buffer.from(await blob.arrayBuffer());
  }

  async _readOriginalText(filename) {
    await this._ensureZipLoaded();
    const entry = this._zipEntries.get(filename);
    if (!entry || typeof entry.getData !== 'function') { throw missingError(filename); }
    return await entry.getData(new TextWriter());
  }

  async _flushZip(targetPath = null) {
    await this._ensureZipLoaded();
    const target = targetPath ?? this.path;
    // Final name set: original order first, then staged-new names sorted.
    const finalNames = [];
    const seen = new Set();
    for (const name of this._zipEntries.keys()) {
      const change = this.staged.get(name);
      if (change && change.op === 'delete') { continue; }
      finalNames.push(name);
      seen.add(name);
    }
    const added = [...this.staged.keys()].filter((n) => !seen.has(n) && this.staged.get(n).op !== 'delete').sort();
    finalNames.push(...added);

    const {BlobWriter: BW, ZipWriter: ZW} = await import('@zip.js/zip.js');
    const blobWriter = new BW();
    const zipWriter = new ZW(blobWriter);
    try {
      for (const name of finalNames) {
        const change = this.staged.get(name);
        if (change) {
          await zipWriter.add(name, new Uint8ArrayReader(new Uint8Array(change.data.buffer, change.data.byteOffset, change.data.byteLength)));
        } else {
          const entry = this._zipEntries.get(name);
          const blob = await entry.getData(new BlobWriter());
          const ab = await blob.arrayBuffer();
          await zipWriter.add(name, new Uint8ArrayReader(new Uint8Array(ab)));
        }
      }
    } finally {
      // ZipWriter.close() finalizes; no separate abort needed on success path.
    }
    const outBlob = await zipWriter.close();
    const outBuf = Buffer.from(await outBlob.arrayBuffer());

    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, outBuf);
    await fs.rename(tmp, target);
    if (targetPath !== null) { return; } // original untouched; keep entries
    try { await this._zipReader.close(); } catch { /* ignore */ }
    this._zipReader = null;
    this._zipEntries = null;
    await this._ensureZipLoaded();
  }
}

/** @param {string} filename */
function missingError(filename) {
  const e = new Error(`File not found: '${filename}'`);
  e.code = 'ENOENT';
  return e;
}
