import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {openDictionary} from '../src/index.js';
import {abs, copyValidDict, freshTmpDir, zipDir} from './helpers.js';
import path from 'node:path';

describe('open + listBanks', () => {
  it('opens an extracted directory', async () => {
    const d = await openDictionary(abs('test/fixtures/valid-dictionary1'));
    assert.equal(d.kind, 'dir');
    assert.equal(d.title, 'Test Dictionary');
    assert.equal(d.version, 3);
    const banks = await d.listBanks();
    assert.equal(banks.term.length, 2);
    assert.equal(banks.tag.length, 3);
    assert.equal(banks.termMeta.length, 1);
    assert.equal(banks.index, 'index.json');
    const counts = await d.countEntries();
    assert.deepEqual(counts, {term: 38, termMeta: 40, kanji: 2, kanjiMeta: 6, tag: 15, total: 101});
    await d.close();
  });

  it('opens a .zip archive the same way', async () => {
    const tmp = await freshTmpDir();
    const zip = await zipDir(abs('test/fixtures/valid-dictionary1'), path.join(tmp, 'dict.zip'));
    const d = await openDictionary(zip);
    assert.equal(d.kind, 'zip');
    assert.equal(d.title, 'Test Dictionary');
    assert.equal(d.version, 3);
    const counts = await d.countEntries();
    assert.deepEqual(counts, {term: 38, termMeta: 40, kanji: 2, kanjiMeta: 6, tag: 15, total: 101});
    await d.close();
  });

  it('rejects non-dictionary paths', async () => {
    await assert.rejects(() => openDictionary(abs('package.json')), /Not a .zip file or directory/);
  });

  it('copies stay independent (copyValidDict helper)', async () => {
    const dir = await copyValidDict();
    const d = await openDictionary(dir);
    assert.equal(d.title, 'Test Dictionary');
    await d.close();
  });
});
