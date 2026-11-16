"use client";

import React, { useLayoutEffect, useRef } from "react";

export interface RemoteCaret {
  id: string;
  name: string;
  color: string;
  start: number;
  end: number;
  head: number;
}

const PALETTE = ["#FF7AB2", "#7CC8FF", "#6BE3B0", "#B99BFF", "#FF9B54", "#FFD84D"];

/** A stable colour per person, so their cursor and name chip always match. */
export function cursorColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

interface LiveTextAreaProps {
  value: string;
  readOnly: boolean;
  remoteCursors: RemoteCaret[];
  onChange: (value: string) => void;
  onSelectionChange: (start: number, end: number) => void;
}

export function LiveTextArea({
  value,
  readOnly,
  remoteCursors,
  onChange,
  onSelectionChange,
}: LiveTextAreaProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef({ start: 0, end: 0 });
  const previousValue = useRef(value);
  const typedLocally = useRef(false);

  const report = (el: HTMLTextAreaElement) => {
    caretRef.current = { start: el.selectionStart, end: el.selectionEnd };
    onSelectionChange(el.selectionStart, el.selectionEnd);
  };

  // When someone else's edit lands, React resets the text and the caret jumps to the end.
  // Shift our caret past their edit so it stays on the same characters.
  useLayoutEffect(() => {
    const before = previousValue.current;
    previousValue.current = value;
    if (typedLocally.current) {
      typedLocally.current = false;
      return;
    }
    const el = textareaRef.current;
    if (!el || before === value || document.activeElement !== el) return;
    const { start, end } = caretRef.current;
    const next = { start: mapIndex(start, before, value), end: mapIndex(end, before, value) };
    el.setSelectionRange(next.start, next.end);
    caretRef.current = next;
  }, [value]);

  return (
    <div
      className={`relative flex-1 min-h-[420px] border-[3px] rounded-3xl transition-all duration-150 ${
        readOnly
          ? "bg-sun/20 border-ink/40 cursor-not-allowed"
          : "bg-white border-ink shadow-pop focus-within:shadow-pop-lg focus-within:-translate-x-0.5 focus-within:-translate-y-0.5"
      }`}
    >
      <div
        ref={backdropRef}
        aria-hidden
        className="absolute inset-0 overflow-hidden p-6 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-transparent pointer-events-none [scrollbar-gutter:stable]"
      >
        {renderBackdrop(value, remoteCursors)}
      </div>
      <textarea
        ref={textareaRef}
        readOnly={readOnly}
        value={value}
        onChange={(e) => {
          typedLocally.current = true;
          onChange(e.target.value);
          report(e.target);
        }}
        onSelect={(e) => report(e.currentTarget)}
        onScroll={(e) => {
          if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className={`relative block w-full h-full min-h-[420px] p-6 bg-transparent font-mono text-sm leading-relaxed outline-none resize-none [scrollbar-gutter:stable] ${
          readOnly ? "text-ink/70 cursor-not-allowed" : ""
        }`}
      />
    </div>
  );
}

/** Where an index in `before` lands in `after`, given the single span of text that changed. */
function mapIndex(index: number, before: string, after: string): number {
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  if (index <= prefix) return index;
  if (index >= before.length - suffix) return index + (after.length - before.length);
  return after.length - suffix;
}

/**
 * Draws the selections and carets of other people behind the text. The backdrop repeats
 * the text exactly (in transparent ink) so each highlight lands on the right characters.
 */
function renderBackdrop(text: string, cursors: RemoteCaret[]): React.ReactNode[] {
  const len = text.length;
  const clamp = (n: number) => Math.max(0, Math.min(len, n));

  const cuts = new Set<number>([0, len]);
  for (const c of cursors) {
    cuts.add(clamp(c.start));
    cuts.add(clamp(c.end));
    cuts.add(clamp(c.head));
  }
  const points = Array.from(cuts).sort((a, b) => a - b);

  const nodes: React.ReactNode[] = [];
  points.forEach((from, i) => {
    const to = points[i + 1] ?? len;

    for (const c of cursors) {
      if (clamp(c.head) === from) {
        nodes.push(<Caret key={`caret-${c.id}-${from}`} name={c.name} color={c.color} />);
      }
    }

    if (to > from) {
      const selector = cursors.filter(
        (c) =>
          c.start !== c.end &&
          Math.min(clamp(c.start), clamp(c.end)) <= from &&
          to <= Math.max(clamp(c.start), clamp(c.end))
      );
      const chunk = text.slice(from, to);
      const top = selector[selector.length - 1];
      nodes.push(
        top ? (
          <span key={`sel-${from}`} style={{ backgroundColor: `${top.color}55` }}>
            {chunk}
          </span>
        ) : (
          <span key={`text-${from}`}>{chunk}</span>
        )
      );
    }
  });

  if (text.endsWith("\n")) {
    nodes.push(<span key="trailing">{"\u200b"}</span>);
  }
  return nodes;
}

function Caret({ name, color }: { name: string; color: string }) {
  return (
    <span className="relative pointer-events-none">
      <span className="absolute left-0 top-0 bottom-0 w-[2px] -ml-px" style={{ backgroundColor: color }} />
      <span
        className="absolute left-0 bottom-full mb-0.5 whitespace-nowrap rounded px-1 text-[10px] font-extrabold leading-4 text-ink border border-ink"
        style={{ backgroundColor: color, fontFamily: "inherit" }}
      >
        {name}
      </span>
    </span>
  );
}
