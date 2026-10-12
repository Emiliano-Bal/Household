import type { RunwayDay } from "./queries";

// Kept out of the component so the chart's geometry can be asserted
// instead of eyeballed — label collisions and out-of-frame coordinates
// are the two things a color validator can't catch.
export const VIEW_W = 720;
export const VIEW_H = 220;
export const PAD = { top: 12, right: 16, bottom: 26, left: 64 } as const;
export const PLOT_W = VIEW_W - PAD.left - PAD.right;
export const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

export interface RunwayGeometry {
  lowest: number;
  highest: number;
  /** One point per elapsed day, plus the day-0 origin at the starting balance. */
  points: Array<{ day: number; cx: number; cy: number; remainingCents: number }>;
  linePoints: string;
  areaPoints: string;
  gridlines: Array<{ cents: number; cy: number }>;
  xTicks: Array<{ day: number; cx: number }>;
  pace: { x1: number; y1: number; x2: number; y2: number };
  /**
   * Where to put the "even pace" label. Anchored two-thirds along the line
   * rather than at its end: the line ends at zero, which is exactly where
   * the x-axis tick labels sit, and the two collided.
   */
  paceLabel: { cx: number; cy: number };
  /** Pixel y of the zero line, or null when the balance never goes negative. */
  zeroY: number | null;
  endRemainingCents: number;
  over: boolean;
  xForDay: (day: number) => number;
  yForCents: (cents: number) => number;
}

export function buildRunwayGeometry({
  days,
  startingCents,
  evenDailyCents,
}: {
  days: RunwayDay[];
  startingCents: number;
  evenDailyCents: number;
}): RunwayGeometry {
  const totalDays = days.length || 1;
  // Future days have no balance yet — drawing them would imply a promise
  // that nothing more will be spent.
  const actual = days.filter((d) => !d.isFuture);

  // The scale must hold the start, the lowest point reached, and 0, so an
  // overspend reads as crossing the axis rather than clipping off-frame.
  const lowest = Math.min(0, startingCents, ...actual.map((d) => d.remainingCents));
  const highest = Math.max(0, startingCents, ...actual.map((d) => d.remainingCents));
  const span = highest - lowest || 1;

  const xForDay = (day: number) => PAD.left + (day / totalDays) * PLOT_W;
  const yForCents = (cents: number) => PAD.top + (1 - (cents - lowest) / span) * PLOT_H;

  const origin = { day: 0, cx: xForDay(0), cy: yForCents(startingCents), remainingCents: startingCents };
  const points = [
    origin,
    ...actual.map((d) => ({ day: d.day, cx: xForDay(d.day), cy: yForCents(d.remainingCents), remainingCents: d.remainingCents })),
  ];

  const linePoints = points.map((p) => `${p.cx},${p.cy}`).join(" ");
  const lastX = points[points.length - 1].cx;
  const baseY = yForCents(lowest);
  const areaPoints = `${linePoints} ${lastX},${baseY} ${origin.cx},${baseY}`;

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const cents = Math.round(lowest + t * span);
    return { cents, cy: yForCents(cents) };
  });

  // The 1st, each following week boundary, and the last day — dropping any
  // week tick that would sit on top of the final one.
  const xTicks = [1, ...[8, 15, 22, 29].filter((d) => d < totalDays - 1), totalDays].map((day) => ({
    day,
    cx: xForDay(day),
  }));

  const endRemainingCents = points[points.length - 1].remainingCents;

  return {
    lowest,
    highest,
    points,
    linePoints,
    areaPoints,
    gridlines,
    xTicks,
    pace: {
      x1: xForDay(0),
      y1: yForCents(startingCents),
      x2: xForDay(totalDays),
      y2: yForCents(startingCents - evenDailyCents * totalDays),
    },
    paceLabel: (() => {
      const day = Math.round(totalDays * 0.66);
      return { cx: xForDay(day), cy: yForCents(startingCents - evenDailyCents * day) - 8 };
    })(),
    zeroY: lowest < 0 ? yForCents(0) : null,
    endRemainingCents,
    over: endRemainingCents < 0,
    xForDay,
    yForCents,
  };
}
