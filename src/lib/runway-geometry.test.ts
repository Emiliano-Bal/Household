// The color validator checks the palette; nothing checks the layout. These
// assert the two things that actually break a chart visually: coordinates
// escaping the frame, and tick labels landing on top of each other.
import { describe, it, expect } from "vitest";
import { buildRunwayGeometry, VIEW_W, VIEW_H, PAD, PLOT_W } from "./runway-geometry";
import type { RunwayDay } from "./queries";

function month(spendByDay: Record<number, number>, startingCents: number, elapsedDays: number, totalDays = 31): RunwayDay[] {
  let running = startingCents;
  const days: RunwayDay[] = [];
  for (let day = 1; day <= totalDays; day++) {
    running -= spendByDay[day] ?? 0;
    days.push({ day, spentCents: spendByDay[day] ?? 0, remainingCents: running, isFuture: day > elapsedDays });
  }
  return days;
}

const inFrame = (v: number, lo: number, hi: number) => v >= lo - 0.01 && v <= hi + 0.01;

describe("runway chart geometry", () => {
  it("keeps every point inside the plot area", () => {
    const g = buildRunwayGeometry({
      days: month({ 2: 15000, 10: 25000, 20: 60000 }, 300000, 31),
      startingCents: 300000,
      evenDailyCents: Math.round(300000 / 31),
    });

    for (const p of g.points) {
      expect(inFrame(p.cx, PAD.left, VIEW_W - PAD.right)).toBe(true);
      expect(inFrame(p.cy, PAD.top, VIEW_H - PAD.bottom)).toBe(true);
    }
    for (const gl of g.gridlines) {
      expect(inFrame(gl.cy, PAD.top, VIEW_H - PAD.bottom)).toBe(true);
    }
    for (const t of g.xTicks) {
      expect(inFrame(t.cx, PAD.left, VIEW_W - PAD.right)).toBe(true);
    }
  });

  it("keeps an overspent balance in frame by including zero in the scale", () => {
    const g = buildRunwayGeometry({
      days: month({ 5: 80000 }, 50000, 30, 30),
      startingCents: 50000,
      evenDailyCents: Math.round(50000 / 30),
    });

    expect(g.lowest).toBe(-30000);
    expect(g.over).toBe(true);
    // The zero line is drawn, and sits inside the plot rather than at an edge.
    expect(g.zeroY).not.toBeNull();
    expect(inFrame(g.zeroY!, PAD.top, VIEW_H - PAD.bottom)).toBe(true);
    for (const p of g.points) {
      expect(inFrame(p.cy, PAD.top, VIEW_H - PAD.bottom)).toBe(true);
    }
  });

  it("omits the zero line when the balance never goes negative", () => {
    const g = buildRunwayGeometry({
      days: month({ 3: 1000 }, 300000, 31),
      startingCents: 300000,
      evenDailyCents: 9677,
    });
    expect(g.zeroY).toBeNull();
  });

  it("never places two x-axis tick labels close enough to collide", () => {
    // ~14px is the narrowest a two-digit 11px label can sit without touching.
    for (const totalDays of [28, 29, 30, 31]) {
      const g = buildRunwayGeometry({
        days: month({}, 100000, totalDays, totalDays),
        startingCents: 100000,
        evenDailyCents: Math.round(100000 / totalDays),
      });
      const xs = g.xTicks.map((t) => t.cx).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThan(14);
      }
      // Ticks are strictly increasing and unique.
      expect(new Set(g.xTicks.map((t) => t.day)).size).toBe(g.xTicks.length);
    }
  });

  it("draws only elapsed days, so a mid-month view stops at today", () => {
    const g = buildRunwayGeometry({
      days: month({ 2: 15000, 10: 25000 }, 300000, 12),
      startingCents: 300000,
      evenDailyCents: 9677,
    });

    // 12 elapsed days plus the day-0 origin.
    expect(g.points).toHaveLength(13);
    expect(g.points[g.points.length - 1].day).toBe(12);
    // The line stops well short of the right edge.
    expect(g.points[g.points.length - 1].cx).toBeLessThan(PAD.left + PLOT_W);
  });

  it("produces a closed area polygon anchored to the baseline", () => {
    const g = buildRunwayGeometry({
      days: month({ 2: 15000 }, 300000, 5),
      startingCents: 300000,
      evenDailyCents: 9677,
    });
    const coords = g.areaPoints.split(" ").map((pair) => pair.split(",").map(Number));
    // Every coordinate is a real number inside the viewBox.
    for (const [cx, cy] of coords) {
      expect(Number.isFinite(cx) && Number.isFinite(cy)).toBe(true);
      expect(inFrame(cx, 0, VIEW_W)).toBe(true);
      expect(inFrame(cy, 0, VIEW_H)).toBe(true);
    }
    // Closes along the baseline: the last two points share a y.
    expect(coords[coords.length - 1][1]).toBeCloseTo(coords[coords.length - 2][1], 5);
  });

  it("survives a month with no income without producing NaN", () => {
    const g = buildRunwayGeometry({
      days: month({ 3: 1000 }, 0, 30, 30),
      startingCents: 0,
      evenDailyCents: 0,
    });
    for (const p of g.points) {
      expect(Number.isFinite(p.cx) && Number.isFinite(p.cy)).toBe(true);
    }
    expect(g.linePoints).not.toContain("NaN");
    expect(g.areaPoints).not.toContain("NaN");
  });

  it("survives a month with no spending at all", () => {
    const g = buildRunwayGeometry({
      days: month({}, 250000, 31),
      startingCents: 250000,
      evenDailyCents: 8065,
    });
    expect(g.over).toBe(false);
    expect(g.endRemainingCents).toBe(250000);
    expect(g.linePoints).not.toContain("NaN");
  });
});

describe("pace label placement", () => {
  // Caught by looking at the render: anchored at the line's end, this label
  // sat directly on top of the last x-axis tick labels.
  it("keeps the pace label clear of the x-axis tick labels", () => {
    for (const totalDays of [28, 30, 31]) {
      const g = buildRunwayGeometry({
        days: month({ 2: 15000 }, 520000, 12, totalDays),
        startingCents: 520000,
        evenDailyCents: Math.round(520000 / totalDays),
      });
      // Tick labels are baselined at VIEW_H - 8; keep a clear band above them.
      expect(g.paceLabel.cy).toBeLessThan(VIEW_H - PAD.bottom - 6);
      // And inside the plot horizontally, not hanging off either edge.
      expect(g.paceLabel.cx).toBeGreaterThan(PAD.left + 20);
      expect(g.paceLabel.cx).toBeLessThan(VIEW_W - PAD.right - 20);
    }
  });
});
