import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, plainText } from './markdown';

describe('guide markdown', () => {
  it('reads titles, headings, paragraphs, lists, notes and tables', () => {
    const blocks = parseMarkdown(
      [
        '# Title',
        '',
        'First **bold** and `code`.',
        '',
        '## Part',
        '### Sub',
        '- one',
        '- two',
        '',
        '1. a',
        '2. b',
        '',
        '> a note',
        '> goes on',
        '',
        '| x | y |',
        '|---|---|',
        '| 1 | 2 |',
      ].join('\n'),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      'title',
      'paragraph',
      'heading',
      'heading',
      'bullets',
      'numbered',
      'note',
      'table',
    ]);
    const note = blocks[6];
    expect(note?.kind === 'note' && plainText(note.inline)).toBe('a note goes on');
    const table = blocks[7];
    expect(table?.kind === 'table' && table.rows).toHaveLength(1);
  });

  it('keeps a numbered list going across a code block', () => {
    const blocks = parseMarkdown(
      ['1. one', '2. two', '3. three', '', '```', 'run me', '```', '', '4. four'].join('\n'),
    );
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    if (list?.kind !== 'numbered') throw new Error('not a list');
    expect(list.items.map((item) => item.number)).toEqual([1, 2, 3, 4]);
    expect(list.items[2]?.extra).toEqual([{ kind: 'code', text: 'run me' }]);
  });

  it('keeps an indented continuation with its step', () => {
    const blocks = parseMarkdown(['1. one', '', '   more about one', '', '2. two'].join('\n'));
    const list = blocks[0];
    if (list?.kind !== 'numbered') throw new Error('not a list');
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.extra).toHaveLength(1);
  });

  it('makes links of /… and http(s) addresses only', () => {
    const [app, web, bad, script] = [
      parseInline('[a](/guide/x/y)'),
      parseInline('[b](https://example.com)'),
      parseInline('[c](ftp://example.com)'),
      parseInline('[d](javascript:alert(1))'),
    ];
    expect(app).toEqual([
      { kind: 'link', href: '/guide/x/y', internal: true, children: [{ kind: 'text', text: 'a' }] },
    ]);
    expect(web?.[0]).toMatchObject({ kind: 'link', internal: false });
    expect(bad).toEqual([{ kind: 'text', text: '[c](ftp://example.com)' }]);
    expect(script?.every((piece) => piece.kind !== 'link')).toBe(true);
    expect(parseInline('[e](//evil.com)').every((piece) => piece.kind !== 'link')).toBe(true);
  });

  it('keeps unknown syntax as text', () => {
    expect(parseInline('a **open and `tick')).toEqual([
      { kind: 'text', text: 'a **open and `tick' },
    ]);
    expect(plainText(parseInline('<b>x</b> *y*'))).toBe('<b>x</b> *y*');
    const [block] = parseMarkdown('#### deep');
    expect(block?.kind === 'paragraph' && plainText(block.inline)).toBe('#### deep');
  });
});
