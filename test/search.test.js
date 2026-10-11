import {describe, it, before} from 'node:test';
import assert from 'node:assert/strict';
import {openDictionary} from '../src/index.js';
import {abs} from './helpers.js';

describe('search', () => {
  let d;
  before(async () => {
    d = await openDictionary(abs('test/fixtures/valid-dictionary1'));
  });

  it('exact term search with location refs', async () => {
    const hits = await d.searchTerms('打つ');
    assert.equal(hits.length, 4);
    assert.deepEqual(hits[0].ref, {bankFile: 'term_bank_1.json', bankType: 'term', entryIndex: 2});
    assert.equal(hits[0].entry[0], '打つ');
  });

  it('matches reading too (including empty-reading normalization)', async () => {
    const byReading = await d.searchTerms('うつ');
    assert.ok(byReading.length >= 2);
    const english = await d.searchTerms('English'); // reading "" == expression
    assert.equal(english.length, 1);
    assert.equal(english[0].entry[0], 'English');
  });

  it('prefix and includes modes', async () => {
    const prefix = await d.searchTerms('打ち', {match: 'prefix'});
    assert.ok(prefix.length >= 4);
    const includes = await d.searchTerms('ち込', {match: 'includes'});
    assert.ok(includes.length >= 4);
    await assert.rejects(() => d.searchTerms('x', {match: 'regex'}), /Unknown match mode/);
  });

  it('limit/offset pagination', async () => {
    const p1 = await d.searchTerms('打つ', {limit: 2});
    const p2 = await d.searchTerms('打つ', {limit: 2, offset: 2});
    assert.equal(p1.length, 2);
    assert.equal(p2.length, 2);
    assert.notDeepEqual(p1[0].ref, p2[0].ref);
  });

  it('restricts to one bank file', async () => {
    const hits = await d.searchTerms('打つ', {bankFile: 'term_bank_2.json'});
    assert.equal(hits.length, 0);
  });

  it('kanji / meta / tag search', async () => {
    const kanji = await d.searchKanji('打');
    assert.equal(kanji.length, 1);
    assert.equal(kanji[0].entry[0], '打');
    const meta = await d.searchTermMeta('打つ');
    assert.ok(meta.length >= 1);
    assert.equal(meta[0].entry[1], 'freq');
    const tags = await d.searchTags('P');
    assert.equal(tags.length, 1);
    assert.equal(tags[0].entry[0], 'P');
  });

  it('getEntry round-trips a ref', async () => {
    const hits = await d.searchTerms('読む');
    assert.equal(hits.length, 1);
    const got = await d.getEntry(hits[0].ref);
    assert.deepEqual(got.entry, hits[0].entry);
    await assert.rejects(() => d.getEntry({bankFile: 'term_bank_1.json', entryIndex: 99999}), /out of range/);
  });
});
