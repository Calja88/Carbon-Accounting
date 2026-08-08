/**
 * Renders AI-generated text.
 *
 * AI output is untrusted content — a model can be steered by an uploaded
 * document into emitting anything at all, including markup. So this renderer
 * never produces HTML from a string: it parses a deliberately small subset of
 * markdown (paragraphs, bullet and numbered lists, bold, inline code) into
 * React elements, and everything else is rendered as plain text. There is no
 * `dangerouslySetInnerHTML` anywhere in this file, and no link rendering, so
 * an injected `javascript:` URL or `<img onerror>` is displayed as the
 * characters it is.
 */

import { Fragment, ReactNode } from "react";
import { cn } from "@/lib/cn";

const BOLD_OR_CODE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(BOLD_OR_CODE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

interface Block {
  kind: "paragraph" | "bullets" | "numbered";
  lines: string[];
}

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.trim() === "") {
      current = null;
      continue;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet) {
      if (current?.kind !== "bullets") {
        current = { kind: "bullets", lines: [] };
        blocks.push(current);
      }
      current.lines.push(bullet[1]);
      continue;
    }

    if (numbered) {
      if (current?.kind !== "numbered") {
        current = { kind: "numbered", lines: [] };
        blocks.push(current);
      }
      current.lines.push(numbered[1]);
      continue;
    }

    // Headings are flattened to emphasised paragraphs — an assistant reply
    // shouldn't be able to hijack the page's heading hierarchy.
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const content = heading ? `**${heading[1]}**` : line;

    if (current?.kind !== "paragraph") {
      current = { kind: "paragraph", lines: [] };
      blocks.push(current);
    }
    current.lines.push(content);
  }

  return blocks;
}

export function AiText({ text, className }: { text: string; className?: string }) {
  const blocks = toBlocks(text);

  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-slate-700", className)}>
      {blocks.map((block, blockIndex) => {
        if (block.kind === "bullets") {
          return (
            <ul key={blockIndex} className="ml-4 list-disc space-y-1">
              {block.lines.map((line, i) => (
                <li key={i}>{renderInline(line, `${blockIndex}-${i}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "numbered") {
          return (
            <ol key={blockIndex} className="ml-4 list-decimal space-y-1">
              {block.lines.map((line, i) => (
                <li key={i}>{renderInline(line, `${blockIndex}-${i}`)}</li>
              ))}
            </ol>
          );
        }
        return <p key={blockIndex}>{renderInline(block.lines.join(" "), String(blockIndex))}</p>;
      })}
    </div>
  );
}
