import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {openDictionary} from '../src/index.js';
import {copyValidDict, freshTmpDir, zipDir} from './helpers.js';

const NEW_TERM = ['テスト', 'てすと', 'n', 'n', 5, ['test definition'], 9999, 'P'];

describe('mutate (add/update/delete + save)', () => {
  it('round-trips term add/update/delete in a directory', async () => {
    const dir = await copyValidDict();
    const d = await openDictionary(dir);
    assert.equal(d.hasUnsavedChanges(), false);

    // add (appends to highest term bank)
    const ref = await d.addEntry('term', NEW_TERM);
    assert.equal(ref.bankType, 'term');
    assert.equal(d.hasUnsavedChanges(), true);
    assert.deepEqual(d.listStaged(), [ref.bankFile]);

    // invalid entries are rejected before staging
    await assert.rejects(() => d.addEntry('term', ['only', 'two']), /Invalid term entry/);
    await assert.rejects(() => d.addEntry('nope', NEW_TERM), /Unknown bank type/);

    // update
    const updated = [...NEW_TERM];
    updated[5] = ['changed definition'];
    await d.updateEntry(ref, updated);
    const got = await d.getEntry(ref);
    assert.deepEqual(got.entry[5], ['changed definition']);

    // save + reopen from disk
    await d.save();
    assert.equal(d.hasUnsavedChanges(), false);
    await d.close();
    const d2 = await openDictionary(dir);
    const hits = await d2.searchTerms('テスト');
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0].entry[5], ['changed definition']);
    assert.equal((await d2.validate()).valid, true);

    // delete
    await d2.deleteEntry(hits[0].ref);
    await d2.save();
    await d2.close();
    const d3 = await openDictionary(dir);
    assert.equal((await d3.searchTerms('テスト')).length, 0);
    assert.equal((await d3.validate()).valid, true);
    await d3.close();
  });

  it('supports kanji/meta/tag mutation + index editing', async () => {
    const dir = await copyValidDict();
    const d = await openDictionary(dir);

    const kref = await d.addEntry('kanji', ['新', 'シン', 'あたら', '', ['new'], {}]);
    assert.equal((await d.getEntry(kref)).entry[0], '新');

    const mref = await d.addEntry('termMeta', ['テスト', 'freq', 123]);
    assert.equal((await d.getEntry(mref)).entry[2], 123);

    const tref = await d.addEntry('tag', ['mytag', 'partOfSpeech', 0, 'my notes', 0]);
    assert.equal((await d.getEntry(tref)).entry[0], 'mytag');

    const index = await d.getIndex();
    await d.setIndex({...index, revision: 'test-2'});
    assert.equal((await d.getIndex()).revision, 'test-2');
    await assert.rejects(() => d.setIndex({...index, title: ''}), /Invalid index/);

    // discard drops everything
    d.discard();
    assert.equal(d.hasUnsavedChanges(), false);
    assert.equal((await d.getIndex()).revision, 'test');
    await d.close();
  });

  it('mutates inside .zip and saves atomically', async () => {
    const tmp = await freshTmpDir();
    const srcZip = await zipDir((await import('./helpers.js')).abs('test/fixtures/valid-dictionary1'), path.join(tmp, 't.zip'));
    const d = await openDictionary(srcZip);
    assert.equal(d.kind, 'zip');
    const ref = await d.addEntry('term', NEW_TERM, {targetBank: 'term_bank_99.json'});
    assert.equal(ref.bankFile, 'term_bank_99.json');
    await d.save();
    await d.close();

    const d2 = await openDictionary(srcZip);
    assert.equal((await d2.searchTerms('テスト')).length, 1);
    assert.equal((await d2.validate()).valid, true);
    // original banks untouched: term_bank_1.json identical bytes
    const before = await fs.readFile((await import('./helpers.js')).abs('test/fixtures/valid-dictionary1/term_bank_1.json'), 'utf8');
    assert.equal(JSON.stringify(await d2.getBank('term_bank_1.json')), JSON.stringify(JSON.parse(before)));
    await d2.close();
  });

  it('saveAs copies a zip and continues there', async () => {
    const tmp = await freshTmpDir();
    const srcZip = await zipDir((await import('./helpers.js')).abs('test/fixtures/valid-dictionary1'), path.join(tmp, 'a.zip'));
    const d = await openDictionary(srcZip);
    await d.addEntry('term', NEW_TERM);
    const out = path.join(tmp, 'b.zip');
    await d.saveAs(out);
    assert.equal(d.path, out);
    assert.equal((await d.searchTerms('テスト')).length, 1);
    await d.close();
    // original file has no staged residue: reopening shows no テスト
    const d0 = await openDictionary(srcZip);
    assert.equal((await d0.searchTerms('テスト')).length, 0);
    await d0.close();
  });

  it('saveAs copies a dir and continues there', async () => {
    const dir = await copyValidDict();
    const d = await openDictionary(dir);
    await d.addEntry('term', NEW_TERM);
    const out = path.join(await freshTmpDir(), 'copy');
    await d.saveAs(out);
    assert.equal(d.path, out);
    assert.equal((await d.searchTerms('テスト')).length, 1);
    await d.close();
    const d0 = await openDictionary(dir);
    assert.equal((await d0.searchTerms('テスト')).length, 0);
    await d0.close();
  });
});
