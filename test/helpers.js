// Shared test helpers (node builtins only). All fixtures are
// self-contained in test/fixtures/ (copied from upstream Yomitan's
// test/data/dictionaries); no network or submodule needed.
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VALID_DICT_DIR = 'test/fixtures/valid-dictionary1';
export const INVALID_DICT_DIRS = [
  'invalid-dictionary1',
  'invalid-dictionary2',
  'invalid-dictionary3',
  'invalid-dictionary4',
  'invalid-dictionary5',
  'invalid-dictionary6',
].map((d) => `test/fixtures/${d}`);

export function abs(rel) {
  return path.join(ROOT, rel);
}

/** Copy a directory to a fresh tmp dir; returns the tmp path. */
export async function freshTmpDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'yomitan-tools-'));
}

export async function copyValidDict() {
  const tmp = await freshTmpDir();
  const dest = path.join(tmp, 'dict');
  await fs.cp(abs(VALID_DICT_DIR), dest, {recursive: true});
  return dest;
}

/** Pack a directory (flat files) into a .zip using our own dependency. */
export async function zipDir(srcDir, outZip) {
  const {BlobWriter, TextReader, Uint8ArrayReader, ZipWriter} = await import('@zip.js/zip.js');
  const names = (await fs.readdir(srcDir)).sort();
  const zw = new ZipWriter(new BlobWriter());
  for (const name of names) {
    const full = path.join(srcDir, name);
    if (!(await fs.stat(full)).isFile()) { continue; }
    if (name.endsWith('.json')) {
      const text = await fs.readFile(full, 'utf8');
      await zw.add(name, new TextReader(text));
    } else {
      const buf = await fs.readFile(full);
      await zw.add(name, new Uint8ArrayReader(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)));
    }
  }
  const blob = await zw.close();
  await fs.writeFile(outZip, Buffer.from(await blob.arrayBuffer()));
  return outZip;
}
