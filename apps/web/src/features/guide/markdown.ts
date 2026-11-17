/**
 * The guide's small Markdown reader (ADR-0214): a fixed subset to a typed block list. No HTML is
 * read and no library is used. Anything outside the subset stays as plain text, never dropped.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; internal: boolean; children: Inline[] };

export interface NumberedItem {
  number: number;
  inline: Inline[];
  /** What belongs to the step and follows it: a code block, an indented paragraph. */
  extra: Block[];
}

export type Block =
  | { kind: 'title'; inline: Inline[] }
  | { kind: 'heading'; level: 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'bullets'; items: Inline[][] }
  | { kind: 'numbered'; items: NumberedItem[] }
  | { kind: 'note'; inline: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] };

/** Only `http(s)://` and in-app `/…` addresses are links. */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\/\S+$/i.test(href) || /^\/(?!\/)\S*$/.test(href);
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === '*' && source.startsWith('**', i)) {
      const end = source.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: 'bold', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (ch === '[') {
      const match = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(source.slice(i));
      if (match) {
        const [whole, label = '', href = ''] = match;
        if (isSafeHref(href)) {
          flush();
          out.push({
            kind: 'link',
            href,
            internal: href.startsWith('/'),
            children: parseInline(label),
          });
        } else {
          text += whole;
        }
        i += whole.length;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

/** The words of some inline pieces, without marks. */
export function plainText(inline: readonly Inline[]): string {
  return inline
    .map((piece) =>
      piece.kind === 'text' || piece.kind === 'code' ? piece.text : plainText(piece.children),
    )
    .join('');
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

const isBlank = (line: string | undefined) => line === undefined || line.trim() === '';

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBER.test(line) ||
    QUOTE.test(line) ||
    (line.trim().startsWith('|') && next !== undefined && TABLE_RULE.test(next))
  );
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const readFence = (): Block => {
    i += 1;
    const body: string[] = [];
    while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
      body.push(lines[i] ?? '');
      i += 1;
    }
    i += 1;
    return { kind: 'code', text: body.join('\n') };
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    if (FENCE.test(line)) {
      blocks.push(readFence());
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = (heading[1] ?? '').length;
      const inline = parseInline((heading[2] ?? '').trim());
      i += 1;
      if (level === 1) blocks.push({ kind: 'title', inline });
      else if (level === 2 || level === 3) blocks.push({ kind: 'heading', level, inline });
      else blocks.push({ kind: 'paragraph', inline: [{ kind: 'text', text: line.trim() }] });
      continue;
    }
    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        parts.push((QUOTE.exec(lines[i] ?? '')?.[1] ?? '').trim());
        i += 1;
      }
      blocks.push({ kind: 'note', inline: parseInline(parts.join(' ').trim()) });
      continue;
    }
    if (line.trim().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = cells(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(cells(lines[i] ?? '').map(parseInline));
        i += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const bullet = BULLET.exec(current);
        if (bullet) items.push((bullet[1] ?? '').trim());
        else if (!isBlank(current) && /^\s+\S/.test(current) && items.length > 0) {
          items[items.length - 1] += ` ${current.trim()}`;
        } else break;
        i += 1;
      }
      blocks.push({ kind: 'bullets', items: items.map(parseInline) });
      continue;
    }
    if (NUMBER.test(line)) {
      const items: NumberedItem[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const numbered = NUMBER.exec(current);
        if (numbered) {
          items.push({
            number: Number(numbered[1]),
            inline: parseInline((numbered[2] ?? '').trim()),
            extra: [],
          });
          i += 1;
          continue;
        }
        const last = items[items.length - 1];
        if (!last) break;
        if (isBlank(current)) {
          // A blank line keeps the list going when an indented line or another step follows.
          let j = i;
          while (j < lines.length && isBlank(lines[j])) j += 1;
          const after = lines[j] ?? '';
          if (j < lines.length && (NUMBER.test(after) || /^\s{2,}\S/.test(after))) {
            i = j;
            continue;
          }
          break;
        }
        if (/^\s{2,}\S/.test(current) && !BULLET.test(current)) {
          if (FENCE.test(current)) {
            last.extra.push(readFence());
          } else {
            last.extra.push({ kind: 'paragraph', inline: parseInline(current.trim()) });
            i += 1;
          }
          continue;
        }
        break;
      }
      blocks.push({ kind: 'numbered', items });
      continue;
    }
    const parts: string[] = [];
    while (i < lines.length && !isBlank(lines[i])) {
      const current = lines[i] ?? '';
      if (parts.length > 0 && startsBlock(current, lines[i + 1])) break;
      parts.push(current.trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', inline: parseInline(parts.join(' ')) });
  }
  return joinSteps(blocks);
}

/**
 * A numbered list, a code block, then more steps: one list, the block belonging to the step it
 * follows, the numbers as written (3 → 4).
 */
function joinSteps(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block) continue;
    if (block.kind !== 'numbered') {
      out.push(block);
      continue;
    }
    const items = [...block.items];
    let j = i + 1;
    for (;;) {
      let k = j;
      while (blocks[k]?.kind === 'code') k += 1;
      const next = blocks[k];
      if (next?.kind !== 'numbered' || k === j) break;
      const last = items[items.length - 1];
      if (last) {
        last.extra = [...last.extra, ...blocks.slice(j, k)];
      }
      items.push(...next.items);
      j = k + 1;
    }
    out.push({ kind: 'numbered', items });
    i = j - 1;
  }
  return out;
}
