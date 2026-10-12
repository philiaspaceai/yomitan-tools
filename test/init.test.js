import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {initDictionary, openDictionary} from '../src/index.js';
import {freshTmpDir} from './helpers.js';

describe('init (new dictionary from scratch)', () => {
  it('creates a valid empty dictionary as a directory', async () => {
    const dir = path.join(await freshTmpDir(), 'new-dict');
    const d = await initDictionary(dir, {title: 'Kamus Baru', revision: '1.0.0'});
    assert.equal(d.title, 'Kamus Baru');
    assert.equal(d.version, 3);
    assert.equal((await d.validate()).valid, true);
    assert.deepEqual(await d.countEntries(), {term: 0, termMeta: 0, kanji: 0, kanjiMeta: 0, tag: 0, total: 0});
    await d.close();
  });

  it('creates a valid empty dictionary as a .zip with options', async () => {
    const zip = path.join(await freshTmpDir(), 'new-dict.zip');
    const d = await initDictionary(zip, {
      title: 'Kamus Zip', revision: '2.0', author: 'tester',
      sourceLanguage: 'ja', targetLanguage: 'id', sequenced: true,
      styles: '.yomitan-glossary { color: red; }',
    });
    assert.equal(d.kind, 'zip');
    assert.equal((await d.validate()).valid, true);
    assert.equal((await d.getIndex()).author, 'tester');
    const banks = await d.listBanks();
    assert.equal(banks.styles, true);
    await d.close();
  });

  it('round-trips from zero: init -> add -> save -> reopen', async () => {
    const zip = path.join(await freshTmpDir(), 'round.zip');
    const d = await initDictionary(zip, {title: 'Round', revision: '1'});
    await d.addEntry('term', ['猫', 'ねこ', 'n', '', 0, ['cat'], -1, '']);
    await d.save();
    await d.close();
    const d2 = await openDictionary(zip);
    assert.equal((await d2.searchTerms('猫')).length, 1);
    assert.equal((await d2.validate()).valid, true);
    await d2.close();
  });

  it('refuses to overwrite without overwrite:true', async () => {
    const dir = path.join(await freshTmpDir(), 'd');
    await initDictionary(dir, {title: 'A', revision: '1'});
    await assert.rejects(() => initDictionary(dir, {title: 'B', revision: '2'}), /Refusing to overwrite/);
    const d = await initDictionary(dir, {title: 'B', revision: '2', overwrite: true});
    assert.equal(d.title, 'B');
    await d.close();
  });

  it('rejects bad input before touching disk', async () => {
    const target = path.join(await freshTmpDir(), 'nope');
    await assert.rejects(() => initDictionary(target, {title: '', revision: '1'}), /title and revision/);
    await assert.rejects(() => initDictionary(target, {title: 'T', revision: '1', format: 9}), /Invalid index/);
    const {promises: fs} = await import('node:fs');
    await assert.rejects(() => fs.stat(target), /ENOENT/); // nothing was created
  });
});
