import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {openDictionary} from '../src/index.js';
import {abs, INVALID_DICT_DIRS} from './helpers.js';

describe('validate', () => {
  it('accepts the official valid dictionary', async () => {
    const d = await openDictionary(abs('test/fixtures/valid-dictionary1'));
    const r = await d.validate();
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
    assert.equal(r.version, 3);
    await d.close();
  });

  const expectedFile = {
    'invalid-dictionary1': 'index.json',
    'invalid-dictionary2': 'kanji_bank_1.json',
    'invalid-dictionary3': 'kanji_meta_bank_1.json',
    'invalid-dictionary4': 'tag_bank_1.json',
    'invalid-dictionary5': 'term_bank_1.json',
    'invalid-dictionary6': 'term_meta_bank_1.json',
  };
  for (const dir of INVALID_DICT_DIRS) {
    const name = dir.split('/').pop();
    it(`rejects ${name}`, async () => {
      const d = await openDictionary(abs(dir));
      const r = await d.validate();
      assert.equal(r.valid, false);
      assert.ok(r.errors.length >= 1);
      assert.ok(r.errors.some((e) => e.file === expectedFile[name]), JSON.stringify(r.errors));
      await d.close();
    });
  }

  it('reports missing index and nested index distinctly', async () => {
    const {freshTmpDir} = await import('./helpers.js');
    const {promises: fs} = await import('node:fs');
    const path = await import('node:path');
    const tmp = await freshTmpDir();
    // Empty dir: no index at all.
    const d = await openDictionary(tmp);
    const r = await d.validate();
    assert.equal(r.valid, false);
    assert.match(r.errors[0].message, /No dictionary index/);
    await d.close();
    // Nested index only.
    await fs.mkdir(path.join(tmp, 'sub'), {recursive: true});
    await fs.writeFile(path.join(tmp, 'sub', 'index.json'), '{"title":"x","revision":"y","format":3}');
    const d2 = await openDictionary(tmp);
    const r2 = await d2.validate();
    assert.equal(r2.valid, false);
    assert.match(r2.errors[0].message, /nested/);
    await d2.close();
  });

  it('validates a single file cheaply', async () => {
    const d = await openDictionary(abs('test/fixtures/valid-dictionary1'));
    const ok = await d.validateFile('term_bank_1.json');
    assert.equal(ok.valid, true);
    await assert.rejects(() => d.validateFile('nope_bank_1.json'), /Not a bank file|File not found/);
    await d.close();
  });

  it('handles version-1 dictionaries (legacy tuple shape)', async () => {
    const {freshTmpDir} = await import('./helpers.js');
    const {promises: fs} = await import('node:fs');
    const path = await import('node:path');
    const tmp = await freshTmpDir();
    await fs.writeFile(path.join(tmp, 'index.json'), JSON.stringify({title: 'V1 Test', format: 1, revision: 'v1'}));
    await fs.writeFile(path.join(tmp, 'term_bank_1.json'), JSON.stringify([
      ['食べる', 'たべる', 'vt', 'v1', 10],
      ['猫', 'ねこ', 'n', '', 5],
    ]));
    await fs.writeFile(path.join(tmp, 'kanji_bank_1.json'), JSON.stringify([
      ['食', 'ショク', 'た.べる', ''],
    ]));
    const d = await openDictionary(tmp);
    assert.equal(d.version, 1);
    assert.equal((await d.validate()).valid, true);
    const hits = await d.searchTerms('食べる');
    assert.equal(hits.length, 1);
    const md = await d.render(hits[0].ref);
    assert.match(md, /# 食べる【たべる】/);
    const ref = await d.addEntry('term', ['飲む', 'のむ', 'vt', 'v5', 3]);
    assert.equal((await d.getEntry(ref)).entry[0], '飲む');
    await d.save();
    assert.equal((await d.validate()).valid, true);
    await d.close();
  });

  it('documents the upstream v1 glossary quirk (faithful to Yomitan)', async () => {
    // Yomitan's own v1 schemas (maxItems 5/4 + additionalItems glossary) reject
    // v1 entries carrying definitions — under BOTH of Yomitan's validators
    // (Ajv and its own JsonSchema). We reproduce that exactly.
    const {freshTmpDir} = await import('./helpers.js');
    const {promises: fs} = await import('node:fs');
    const path = await import('node:path');
    const tmp = await freshTmpDir();
    await fs.writeFile(path.join(tmp, 'index.json'), JSON.stringify({title: 'V1 Glossary', format: 1, revision: 'v1'}));
    await fs.writeFile(path.join(tmp, 'term_bank_1.json'), JSON.stringify([
      ['食べる', 'たべる', 'vt', 'v1', 10, 'to eat'],
    ]));
    const d = await openDictionary(tmp);
    const r = await d.validateFile('term_bank_1.json');
    assert.equal(r.valid, false);
    // ...but reading/rendering such legacy data still works (for migration).
    const hits = await d.searchTerms('食べる');
    assert.equal(hits.length, 1);
    assert.match(await d.render(hits[0].ref), /to eat/);
    await d.close();
  });
});
