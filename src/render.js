// Render raw Yomitan bank entries to human-readable Markdown.
// Pure functions, no I/O, no dependencies. The structured-content traversal
// mirrors ext/js/display/structured-content-generator.js, but emits Markdown
// instead of DOM (similar goal to _getStructuredContentText in
// ext/js/templates/anki-template-renderer.js).
//
// This is intentionally LOSSY: visual-only style (fontSize, colors, borders,
// collapsed state) is dropped. What survives is the readable text structure.
import {effectiveReading, splitTags} from './constants.js';

const DEFAULT_MAX_CHARS = 20000;
const TRUNCATED_SUFFIX = '\n\n…[truncated]';

/** @param {unknown} v */
function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------- tiny markdown helpers ----------

/** Minimal escaping: keep text readable, protect link/table structure. */
function escText(s) {
  return String(s).replace(/\\/g, '\\\\');
}

function escLinkText(s) {
  return escText(s).replace(/\[/g, '(').replace(/\]/g, ')').replace(/\r?\n/g, ' ');
}

/** Inline single-line variant (list items, table cells). */
function oneLine(s) {
  return escText(s).replace(/\r?\n\s*/g, ' ').replace(/\|/g, '\\|');
}

// ---------- structured content -> markdown ----------

/**
 * @param {unknown} node structured-content node
 * @returns {string} inline markdown (may contain newlines for blocks)
 */
function renderSC(node) {
  if (typeof node === 'string') { return escText(node); }
  if (node === null || typeof node !== 'object') { return ''; }
  if (Array.isArray(node)) { return node.map(renderSC).join(''); }
  const tag = node.tag;
  const inner = typeof node.content === 'undefined' ? '' : renderSC(node.content);
  switch (tag) {
    case 'br': return '\n';
    case 'ruby':
    case 'rt':
    case 'rp':
    case 'thead':
    case 'tbody':
    case 'tfoot':
    case 'tr':
      return inner;
    case 'span': return applyStyle(node, inner);
    case 'div': return `${applyStyle(node, inner)}\n`;
    case 'td':
    case 'th':
      return inner;
    case 'table': return renderSCTable(node);
    case 'ul': return renderSCList(node, false);
    case 'ol': return renderSCList(node, true);
    case 'li': return inner; // handled by parent list; standalone -> inline
    case 'details': return renderSCDetails(node);
    case 'summary': return inner;
    case 'img': {
      const alt = typeof node.alt === 'string' && node.alt !== '' ? escLinkText(node.alt) : 'image';
      const p = typeof node.path === 'string' ? node.path : '';
      return `![${alt}](${p})`;
    }
    case 'a': {
      const text = escLinkText(inlineText(node.content));
      const href = typeof node.href === 'string' ? node.href : '';
      return href !== '' ? `[${text === '' ? href : text}](${href})` : text;
    }
    default:
      return inner; // forward-compat: unknown future tags degrade to children
  }
}

/** @param {unknown} content */
function inlineText(content) {
  if (typeof content === 'string') { return content; }
  if (content === null || typeof content !== 'object') { return ''; }
  if (Array.isArray(content)) { return content.map(inlineText).join(''); }
  if (content.tag === 'br') { return '\n'; }
  if (typeof content.content === 'undefined') { return ''; }
  return inlineText(content.content);
}

function applyStyle(node, inner) {
  const style = isObj(node.style) ? node.style : null;
  if (!style) { return inner; }
  const bold = style.fontWeight === 'bold';
  const italic = style.fontStyle === 'italic';
  if (bold && italic) { return `***${inner}***`; }
  if (bold) { return `**${inner}**`; }
  if (italic) { return `*${inner}*`; }
  return inner;
}

/** @param {{content?: unknown}} tableNode */
function renderSCTable(tableNode) {
  const rows = [];
  collectRows(tableNode.content, rows);
  if (rows.length === 0) { return ''; }
  const cells = rows.map((tr) => collectCells(tr));
  const width = Math.max(...cells.map((r) => r.length), 1);
  const norm = cells.map((r) => {
    const row = r.map((c) => oneLine(c).trim());
    while (row.length < width) { row.push(''); }
    return row;
  });
  const lines = [];
  lines.push(`| ${norm[0].join(' | ')} |`);
  lines.push(`| ${norm[0].map(() => '---').join(' | ')} |`);
  for (const row of norm.slice(1)) { lines.push(`| ${row.join(' | ')} |`); }
  return `\n${lines.join('\n')}\n`;
}

/** @param {unknown} content @param {Array} out */
function collectRows(content, out) {
  if (content === null || typeof content !== 'object') { return; }
  if (Array.isArray(content)) {
    for (const c of content) { collectRows(c, out); }
    return;
  }
  if (content.tag === 'tr') { out.push(content); return; }
  if (typeof content.content !== 'undefined') { collectRows(content.content, out); }
}

/** @param {{content?: unknown}} tr */
function collectCells(tr) {
  const out = [];
  collectCellsInto(tr.content, out);
  return out;
}

/** @param {unknown} content @param {string[]} out */
function collectCellsInto(content, out) {
  if (content === null || typeof content !== 'object') { return; }
  if (Array.isArray(content)) {
    for (const c of content) { collectCellsInto(c, out); }
    return;
  }
  if (content.tag === 'td' || content.tag === 'th') {
    out.push(inlineText(content.content));
    return;
  }
  if (typeof content.content !== 'undefined') { collectCellsInto(content.content, out); }
}

/** @param {{content?: unknown}} listNode */
function renderSCList(listNode, ordered) {
  const items = [];
  collectItems(listNode.content, items);
  if (items.length === 0) { return ''; }
  return `\n${items.map((it, i) => {
    const text = oneLine(inlineText(it.content ?? it)).trim();
    return ordered ? `${i + 1}. ${text}` : `- ${text}`;
  }).join('\n')}\n`;
}

/** @param {unknown} content @param {Array} out */
function collectItems(content, out) {
  if (content === null || typeof content !== 'object') { return; }
  if (Array.isArray(content)) {
    for (const c of content) { collectItems(c, out); }
    return;
  }
  if (content.tag === 'li') { out.push(content); return; }
  if (typeof content.content !== 'undefined') { collectItems(content.content, out); }
}

/** @param {{content?: unknown}} node */
function renderSCDetails(node) {
  const content = node.content;
  let summary = '';
  let rest = [];
  if (Array.isArray(content)) {
    const idx = content.findIndex((c) => isObj(c) && c.tag === 'summary');
    if (idx >= 0) {
      summary = oneLine(inlineText(content[idx].content)).trim();
      rest = [...content.slice(0, idx), ...content.slice(idx + 1)];
    } else {
      rest = content;
    }
  } else if (typeof content !== 'undefined') {
    rest = [content];
  }
  const body = renderSC(rest).trim();
  const head = summary !== '' ? `**▶ ${escText(summary)}**` : '**▶ details**';
  return `\n${head}\n${body}\n`;
}

// ---------- glossary ----------

/**
 * @param {unknown} g single glossary item
 * @returns {string} markdown for one numbered definition
 */
function renderGlossaryItem(g) {
  if (typeof g === 'string') { return escText(g); }
  if (Array.isArray(g)) {
    // Deinflection entry: [uninflectedTerm, [rules...]]
    const [term, rules] = g;
    const r = Array.isArray(rules) ? rules.join(', ') : String(rules ?? '');
    return `_→ ${escText(term)}${r !== '' ? ` (${escText(r)})` : ''}_`;
  }
  if (!isObj(g)) { return ''; }
  switch (g.type) {
    case 'text': return escText(g.text ?? '');
    case 'image': {
      const alt = typeof g.alt === 'string' && g.alt !== '' ? escLinkText(g.alt) : (typeof g.description === 'string' && g.description !== '' ? escLinkText(g.description) : 'image');
      const p = typeof g.path === 'string' ? g.path : '';
      const desc = typeof g.description === 'string' && g.description !== '' && g.description !== alt ? `\n${escText(g.description)}` : '';
      return `![${alt}](${p})${desc}`;
    }
    case 'structured-content':
      return renderSC(g.content).trim();
    default:
      return '';
  }
}

/** Indent continuation lines so numbered lists stay readable. */
function indentContinuation(text) {
  const lines = String(text).split('\n');
  return [lines[0], ...lines.slice(1).map((l) => (l.trim() === '' ? '' : `   ${l}`))].join('\n');
}

// ---------- public entry renderers ----------

/**
 * Render a raw TERM bank entry (v1 or v3 tuple) to Markdown.
 * @param {unknown[]} entry raw tuple
 * @param {object} [ctx]
 * @param {Map<string,string>|Record<string,string>} [ctx.tagNotes] tag name -> notes
 * @param {Array<{reading?:string,positions?:Array<number|string>,tags?:string[]}>} [ctx.pitches]
 * @param {Array<{dictionary?:string,frequency?:unknown,displayValue?:unknown}>} [ctx.frequencies]
 * @param {Array<{reading?:string,ipa?:string}>} [ctx.ipa]
 * @param {number} [ctx.maxChars]
 */
export function renderTerm(entry, ctx = {}) {
  if (!Array.isArray(entry)) { throw new Error('Term entry must be an array tuple'); }
  const v3 = entry.length === 8;
  const expression = String(entry[0] ?? '');
  const reading = effectiveReading(expression, String(entry[1] ?? ''));
  const definitionTags = splitTags(entry[2] ?? '');
  const rules = splitTags(entry[3] ?? '');
  const score = entry[4];
  const glossary = v3 ? (entry[5] ?? []) : entry.slice(5);
  const sequence = v3 ? entry[6] : null;
  const termTags = v3 ? splitTags(entry[7] ?? '') : [];

  const lines = [];
  lines.push(reading !== expression ? `# ${expression}【${reading}】` : `# ${expression}`);
  lines.push('');
  const meta = [];
  if (definitionTags.length > 0) { meta.push(`tags: ${definitionTags.map((t) => `\`${t}\``).join(' ')}`); }
  if (rules.length > 0) { meta.push(`rules: ${rules.map((t) => `\`${t}\``).join(' ')}`); }
  if (typeof score === 'number') { meta.push(`score: ${score}`); }
  if (typeof sequence === 'number') { meta.push(`seq: ${sequence}`); }
  if (termTags.length > 0) { meta.push(`term tags: ${termTags.map((t) => `\`${t}\``).join(' ')}`); }
  if (meta.length > 0) { lines.push(`_${meta.join(' · ')}_`); lines.push(''); }

  const tagNotes = ctx.tagNotes;
  const notes = [];
  for (const t of [...definitionTags, ...termTags]) {
    const n = tagNotes instanceof Map ? tagNotes.get(t) : (isObj(tagNotes) ? tagNotes[t] : undefined);
    if (typeof n === 'string' && n !== '') { notes.push(`- \`${t}\`: ${escText(n)}`); }
  }
  if (notes.length > 0) { lines.push('**Tags**'); lines.push(''); lines.push(...notes); lines.push(''); }

  const items = Array.isArray(glossary) ? glossary : [];
  if (items.length > 0) {
    lines.push('**Definitions**'); lines.push('');
    items.forEach((g, i) => {
      lines.push(`${i + 1}. ${indentContinuation(renderGlossaryItem(g))}`);
    });
    lines.push('');
  } else {
    lines.push('_No definitions._'); lines.push('');
  }

  if (Array.isArray(ctx.pitches) && ctx.pitches.length > 0) {
    lines.push('**Pitch**'); lines.push('');
    for (const p of ctx.pitches) {
      const r = typeof p.reading === 'string' ? p.reading : reading;
      const pos = Array.isArray(p.positions) ? p.positions.join(', ') : String(p.positions ?? '');
      lines.push(`- 📉 ${escText(r)}: ${escText(pos)}`);
    }
    lines.push('');
  }
  if (Array.isArray(ctx.frequencies) && ctx.frequencies.length > 0) {
    lines.push('**Frequency**'); lines.push('');
    for (const f of ctx.frequencies) {
      const d = typeof f.dictionary === 'string' && f.dictionary !== '' ? ` (${escText(f.dictionary)})` : '';
      const v = f.displayValue ?? f.frequency;
      lines.push(`- ${escText(fmtFreq(v))}${d}`);
    }
    lines.push('');
  }
  if (Array.isArray(ctx.ipa) && ctx.ipa.length > 0) {
    lines.push('**IPA**'); lines.push('');
    for (const t of ctx.ipa) {
      lines.push(`- /${escText(t.ipa ?? '')}/ (${escText(t.reading ?? reading)})`);
    }
    lines.push('');
  }

  return truncate(lines.join('\n').trimEnd() + '\n', ctx.maxChars);
}

/**
 * Render a raw KANJI bank entry (v1 or v3 tuple) to Markdown.
 * @param {unknown[]} entry
 * @param {object} [ctx] {tagNotes, frequencies:[{dictionary,frequency,displayValue}], maxChars}
 */
export function renderKanji(entry, ctx = {}) {
  if (!Array.isArray(entry)) { throw new Error('Kanji entry must be an array tuple'); }
  const v3 = entry.length === 6;
  const character = String(entry[0] ?? '');
  const onyomi = splitTags(entry[1] ?? '');
  const kunyomi = splitTags(entry[2] ?? '');
  const tags = splitTags(entry[3] ?? '');
  const meanings = v3 ? (entry[4] ?? []) : entry.slice(4);
  const stats = v3 ? entry[5] : null;

  const lines = [`# ${character}`, ''];
  const rd = [];
  if (onyomi.length > 0) { rd.push(`onyomi: ${onyomi.join('、')}`); }
  if (kunyomi.length > 0) { rd.push(`kunyomi: ${kunyomi.join('、')}`); }
  if (tags.length > 0) { rd.push(`tags: ${tags.map((t) => `\`${t}\``).join(' ')}`); }
  if (rd.length > 0) { lines.push(`_${rd.join(' · ')}_`); lines.push(''); }
  if (Array.isArray(meanings) && meanings.length > 0) {
    lines.push('**Meanings**'); lines.push('');
    meanings.forEach((m, i) => { lines.push(`${i + 1}. ${escText(m)}`); });
    lines.push('');
  }
  if (isObj(stats)) {
    const keys = Object.keys(stats);
    if (keys.length > 0) {
      lines.push('**Stats**'); lines.push('');
      for (const k of keys) { lines.push(`- ${escText(k)}: ${escText(stats[k])}`); }
      lines.push('');
    }
  }
  if (Array.isArray(ctx.frequencies) && ctx.frequencies.length > 0) {
    lines.push('**Frequency**'); lines.push('');
    for (const f of ctx.frequencies) {
      const d = typeof f.dictionary === 'string' && f.dictionary !== '' ? ` (${escText(f.dictionary)})` : '';
      lines.push(`- ${escText(fmtFreq(f.displayValue ?? f.frequency))}${d}`);
    }
    lines.push('');
  }
  return truncate(lines.join('\n').trimEnd() + '\n', ctx.maxChars);
}

/** @param {unknown[]} entry tag 5-tuple */
export function renderTag(entry) {
  if (!Array.isArray(entry)) { throw new Error('Tag entry must be an array tuple'); }
  const [name, category, order, notes, score] = entry;
  const lines = [`# \`${escText(name ?? '')}\``, '', `_${escText(category ?? '')} · order: ${order ?? ''} · score: ${score ?? ''}_`, ''];
  if (typeof notes === 'string' && notes !== '') { lines.push(escText(notes)); lines.push(''); }
  return lines.join('\n');
}

/** @param {unknown[]} entry term/kanji meta 3-tuple */
export function renderMeta(bankType, entry) {
  if (!Array.isArray(entry)) { throw new Error('Meta entry must be an array tuple'); }
  const [head, mode, data] = entry;
  return `# ${escText(head ?? '')} (${escText(mode ?? '')})\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
}

/**
 * Dispatcher for any bank type.
 * @param {'term'|'termMeta'|'kanji'|'kanjiMeta'|'tag'} bankType
 * @param {unknown[]} entry
 * @param {object} [ctx]
 */
export function renderEntry(bankType, entry, ctx = {}) {
  switch (bankType) {
    case 'term': return renderTerm(entry, ctx);
    case 'kanji': return renderKanji(entry, ctx);
    case 'tag': return renderTag(entry);
    case 'termMeta':
    case 'kanjiMeta':
      return renderMeta(bankType, entry);
    default:
      throw new Error(`Unknown bank type: ${bankType}`);
  }
}

function fmtFreq(v) {
  if (v === null || typeof v === 'undefined') { return '?'; }
  if (typeof v === 'object') {
    const disp = v.displayValue ?? v.value ?? v.frequency;
    return typeof disp === 'undefined' ? JSON.stringify(v) : String(disp);
  }
  return String(v);
}

/** @param {string} md @param {number|undefined} maxChars */
function truncate(md, maxChars) {
  const limit = typeof maxChars === 'number' ? maxChars : DEFAULT_MAX_CHARS;
  if (md.length <= limit) { return md; }
  return md.slice(0, Math.max(0, limit - TRUNCATED_SUFFIX.length)) + TRUNCATED_SUFFIX;
}
