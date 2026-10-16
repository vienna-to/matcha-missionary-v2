"use client";

import { useSyncExternalStore } from "react";

/** True below the md breakpoint (768px). False on the server and first paint. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(max-width: 767px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

// Phone category axes reserve a width fitted to the longest label line, in real
// pixels (measured with the page font), so the text never runs past the SVG.
const FONT_PX = 11;
const MIN_AXIS = 44;
const MAX_AXIS = 108;
const TICK_PAD = 12; // tick mark + gap to the text
const MAX_TEXT_PX = MAX_AXIS - TICK_PAD;

let ctx: CanvasRenderingContext2D | null | undefined;
function textPx(text: string): number {
  if (ctx === undefined) {
    ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!ctx) return text.length * 7;
  ctx.font = `${FONT_PX}px ${getComputedStyle(document.body).fontFamily}`;
  return ctx.measureText(text).width * 1.04;
}

function clip(line: string, keepEnd: boolean): string {
  if (textPx(line) <= MAX_TEXT_PX) return line;
  let t = line;
  while (t.length > 1) {
    t = keepEnd ? t.slice(1) : t.slice(0, -1);
    const out = keepEnd ? `…${t}` : `${t}…`;
    if (textPx(out) <= MAX_TEXT_PX) return out;
  }
  return line;
}

/** Split a name over at most two lines on the space nearest the middle.
 *  A line is only clipped with an ellipsis when it still cannot fit. */
export function splitLabel(name: string, keepEnd = false): string[] {
  const text = name.trim();
  if (textPx(text) <= MAX_TEXT_PX) return [text];
  const spaces: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === " ") spaces.push(i);
  if (spaces.length === 0) return [clip(text, keepEnd)];
  const mid = text.length / 2;
  const at = spaces.reduce((best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best));
  return [text.slice(0, at), text.slice(at + 1)].map((l) => clip(l, keepEnd));
}

/** Display lines per name. Two different names that would render identically
 *  (same first words, clipped) are re-split keeping the END of each line, so
 *  the part that differs stays visible. */
export function labelLines(names: string[], lower: boolean): Map<string, string[]> {
  const fmt = (n: string) => (lower ? n.toLowerCase() : n);
  const out = new Map<string, string[]>();
  for (const n of names) out.set(n, splitLabel(fmt(n)));
  const seen = new Map<string, string[]>();
  for (const [n, lines] of out) {
    const k = lines.join("|");
    seen.set(k, [...(seen.get(k) ?? []), n]);
  }
  for (const group of seen.values()) {
    if (group.length > 1) for (const n of group) out.set(n, splitLabel(fmt(n), true));
  }
  return out;
}

type TickProps = {
  x?: number;
  y?: number;
  payload?: { value: string };
  lines: Map<string, string[]>;
};

function TwoLineTick({ x = 0, y = 0, payload, lines }: TickProps) {
  const value = String(payload?.value ?? "");
  const parts = lines.get(value) ?? [value];
  return (
    <text x={x} y={y} textAnchor="end" fill="#374151" fontSize={11}>
      {parts.map((l, i) => (
        <tspan key={i} x={x - 4} dy={i === 0 ? (parts.length > 1 ? "-0.15em" : "0.35em") : "1.1em"}>
          {l}
        </tspan>
      ))}
      <title>{value}</title>
    </text>
  );
}

/** Y (category) axis props. Desktop keeps its fixed width and one-line labels;
 *  phones get a width fitted to the labels and a two-line tick. */
export function categoryAxis(
  isMobile: boolean,
  names: string[],
  desktopWidth: number,
  lower: boolean,
) {
  if (!isMobile) {
    return lower
      ? { width: desktopWidth, tickFormatter: (v: string) => v.toLowerCase() }
      : { width: desktopWidth };
  }
  const lines = labelLines(names, lower);
  const longest = Math.max(0, ...[...lines.values()].flatMap((l) => l.map(textPx)));
  return {
    width: Math.min(MAX_AXIS, Math.max(MIN_AXIS, Math.ceil(longest) + TICK_PAD)),
    interval: 0 as const,
    tick: <TwoLineTick lines={lines} />,
  };
}

/** Chart margins: no wasted left gutter on phones. */
export const barMargin = (isMobile: boolean) =>
  isMobile
    ? { left: 0, right: 20, top: 8, bottom: 8 }
    : { left: 24, right: 16, top: 8, bottom: 8 };
