import {describe, it, before} from 'node:test';
import assert from 'node:assert/strict';
import {openDictionary, renderEntry, renderTerm} from '../src/index.js';
import {abs} from './helpers.js';

describe('render to markdown', () => {
  let d;
  before(async () => {
    d = await openDictionary(abs('test/fixtures/valid-dictionary1'));
  });

  it('renders a plain term with tags + frequency context', async () => {
    const hits = await d.searchTerms('読む');
    const md = await d.render(hits[0].ref);
    assert.match(md, /^# 読む【よむ】/m);
    assert.match(md, /to read/);
    assert.match(md, /\*\*Definitions\*\*/);
  });

  it('renders structured content (tables, lists, ruby, images, links)', async () => {
    const hits = await d.searchTerms('内容');
    assert.equal(hits.length, 1);
    const md = await d.render(hits[0].ref, {maxChars: 100000});
    assert.match(md, /naiyou definition 1/);
    assert.match(md, /内\(ない\)/); // ruby
    assert.match(md, /\| Header 1 \| Header 2/); // table
    assert.match(md, /- Unordered list item 1/); // list
    assert.match(md, /!\[.*\]\(image\.gif\)/); // image
    assert.match(md, /\[external link\]\(https:\/\/foosoft\.net/); // external link
  });

  it('renders deinflected entries and kanji', async () => {
    const hits = await d.searchTerms('のたもうた');
    assert.equal(hits.length, 1);
    const md = await d.render(hits[0].ref);
    assert.match(md, /→ のたまう/);
    const kanji = await d.searchKanji('打');
    const kmd = await d.render(kanji[0].ref);
    assert.match(kmd, /^# 打/m);
    assert.match(kmd, /utsu meaning 1/);
  });

  it('renders tags and meta rows standalone', async () => {
    const tags = await d.searchTags('P');
    assert.match(await d.render(tags[0].ref), /popular term/);
    const meta = await d.searchTermMeta('打つ');
    assert.match(await d.render(meta[0].ref), /打つ \(freq\)/);
  });

  it('truncates huge output with a marker', () => {
    const big = renderTerm(['あ', 'あ', '', '', 0, ['x'.repeat(500)], 1, ''], {maxChars: 100});
    assert.ok(big.endsWith('…[truncated]\n') || big.includes('…[truncated]'));
  });

  it('renderEntry dispatcher rejects unknown types', async () => {
    assert.throws(() => renderEntry('nope', []), /Unknown bank type/);
  });
});
