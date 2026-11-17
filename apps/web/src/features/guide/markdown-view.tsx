import { Check, Copy } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Block, Inline } from './markdown';

function InlineView({ pieces }: { pieces: readonly Inline[] }): ReactNode {
  return pieces.map((piece, index) => {
    const key = `${index}`;
    switch (piece.kind) {
      case 'text':
        return <span key={key}>{piece.text}</span>;
      case 'bold':
        return (
          <strong key={key} className="font-semibold">
            <InlineView pieces={piece.children} />
          </strong>
        );
      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-fill px-1 py-0.5 font-mono text-[0.85em] break-words"
          >
            {piece.text}
          </code>
        );
      case 'link':
        return piece.internal ? (
          <Link key={key} to={piece.href} className="text-link hover:underline">
            <InlineView pieces={piece.children} />
          </Link>
        ) : (
          <a
            key={key}
            href={piece.href}
            target="_blank"
            rel="noreferrer"
            className="text-link hover:underline"
          >
            <InlineView pieces={piece.children} />
          </a>
        );
    }
  });
}

/** A command or a file's text, monospace, copied with one button; long lines scroll inside. */
function CodeBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  const Icon = copied ? Check : Copy;
  return (
    <div className="min-w-0 overflow-hidden rounded-lg bg-fill ring-1 ring-black/[0.06]">
      <div className="flex justify-end px-2 pt-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
          <Icon aria-hidden />
          {copied ? t('guide.copied') : t('guide.copy')}
        </Button>
      </div>
      <pre className="overflow-x-auto px-4 pt-1 pb-3 font-mono text-[0.8125rem] leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.kind) {
    case 'title':
      return null;
    case 'heading':
      return block.level === 2 ? (
        <h2 className="mt-4 text-lg font-semibold">
          <InlineView pieces={block.inline} />
        </h2>
      ) : (
        <h3 className="mt-2 text-base font-semibold">
          <InlineView pieces={block.inline} />
        </h3>
      );
    case 'paragraph':
      return (
        <p className="leading-relaxed">
          <InlineView pieces={block.inline} />
        </p>
      );
    case 'bullets':
      return (
        <ul className="list-disc space-y-1.5 pl-6 leading-relaxed">
          {block.items.map((item, index) => (
            <li key={`${index}`}>
              <InlineView pieces={item} />
            </li>
          ))}
        </ul>
      );
    case 'numbered':
      return (
        <ol
          start={block.items[0]?.number}
          className="list-decimal space-y-3 pl-6 leading-relaxed marker:font-medium marker:text-muted-foreground"
        >
          {block.items.map((item, index) => (
            <li key={`${index}`} value={item.number} className="pl-1">
              <InlineView pieces={item.inline} />
              {item.extra.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {item.extra.map((extra, at) => (
                    <BlockView key={`${at}`} block={extra} />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      );
    case 'note':
      return (
        <blockquote className="rounded-lg border-l-4 border-border bg-fill px-4 py-3 leading-relaxed text-muted-foreground">
          <InlineView pieces={block.inline} />
        </blockquote>
      );
    case 'code':
      return <CodeBlock text={block.text} />;
    case 'table':
      return (
        <div className="overflow-hidden rounded-lg ring-1 ring-black/[0.08]">
          <Table>
            <TableHeader>
              <TableRow>
                {block.head.map((cell, index) => (
                  <TableHead key={`${index}`} className="whitespace-normal">
                    <InlineView pieces={cell} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((row, index) => (
                <TableRow key={`${index}`}>
                  {row.map((cell, at) => (
                    <TableCell
                      key={`${at}`}
                      className="h-auto py-2 align-top whitespace-normal leading-relaxed"
                    >
                      <InlineView pieces={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
  }
}

/** The body of an article (its `#` title is the page header's). */
export function MarkdownView({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="min-w-0 space-y-4 text-sm break-words">
      {blocks.map((block, index) => (
        <BlockView key={`${index}`} block={block} />
      ))}
    </div>
  );
}
