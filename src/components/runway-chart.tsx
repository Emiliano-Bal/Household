"use client";

import { useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import { buildRunwayGeometry, VIEW_W, VIEW_H, PAD, PLOT_W, PLOT_H } from "@/lib/runway-geometry";
import type { RunwayDay } from "@/lib/queries";

// One series (what's actually left) plus a reference pace line, so this is
// the "emphasis" form: one accent hue, context in gray. A single series
// needs no legend box — the pace line is direct-labelled on the plot.
// Both hues validated against the white surface (CVD ΔE 9.6 deutan,
// normal-vision 31.6, contrast >= 3:1); the red is a reserved status color
// and never appears without a word naming the state.
const ACCENT = "#059669"; // emerald-600
const OVER = "#ef4444"; // red-500
const GRID = "#e2e8f0"; // slate-200, one shade off the surface
const MUTED = "#94a3b8"; // slate-400

export function RunwayChart({
  days,
  startingCents,
  elapsedDays,
  evenDailyCents,
}: {
  days: RunwayDay[];
  startingCents: number;
  elapsedDays: number;
  evenDailyCents: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const g = buildRunwayGeometry({ days, startingCents, evenDailyCents });
  const totalDays = days.length || 1;
  const stroke = g.over ? OVER : ACCENT;
  // Hovering past today would read a balance that hasn't happened yet.
  const lastReadableDay = Math.max(1, Math.min(elapsedDays || totalDays, totalDays));

  function pickDay(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Map client px onto the viewBox, which scales with the container.
    const vx = ((clientX - rect.left) / rect.width) * VIEW_W;
    const day = Math.round(((vx - PAD.left) / PLOT_W) * totalDays);
    // The crosshair snaps to the nearest day — the reader aims at a date,
    // not at a 2px line.
    setHoverDay(day < 1 ? null : Math.min(day, lastReadableDay));
  }

  const hovered = hoverDay === null ? null : days.find((d) => d.day === hoverDay) ?? null;
  const paceAtHover = hoverDay === null ? 0 : startingCents - evenDailyCents * hoverDay;
  const hoverX = hovered ? g.xForDay(hovered.day) : 0;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`Money remaining through the month: starts at ${formatCents(startingCents)}, standing at ${formatCents(g.endRemainingCents)} on day ${lastReadableDay} of ${totalDays}. The table below lists every day with spending.`}
        onPointerMove={(e) => pickDay(e.clientX)}
        onPointerLeave={() => setHoverDay(null)}
      >
        {/* Gridlines: solid hairlines one shade off the surface, never dashed. */}
        {g.gridlines.map((gl) => (
          <g key={gl.cents}>
            <line x1={PAD.left} x2={VIEW_W - PAD.right} y1={gl.cy} y2={gl.cy} stroke={GRID} strokeWidth={1} />
            <text
              x={PAD.left - 8}
              y={gl.cy + 4}
              textAnchor="end"
              fontSize={11}
              fill={MUTED}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatCents(gl.cents)}
            </text>
          </g>
        ))}

        {g.zeroY !== null && (
          <line x1={PAD.left} x2={VIEW_W - PAD.right} y1={g.zeroY} y2={g.zeroY} stroke={OVER} strokeWidth={1} opacity={0.5} />
        )}

        {g.xTicks.map((t) => (
          <text key={t.day} x={t.cx} y={VIEW_H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>
            {t.day}
          </text>
        ))}

        {/* Reference pace: dashed because it is a target, not a gridline. */}
        <line x1={g.pace.x1} y1={g.pace.y1} x2={g.pace.x2} y2={g.pace.y2} stroke={MUTED} strokeWidth={1.5} strokeDasharray="4 4" />
        <text x={g.paceLabel.cx} y={g.paceLabel.cy} textAnchor="middle" fontSize={10} fill={MUTED}>
          even pace
        </text>

        <polygon points={g.areaPoints} fill={stroke} opacity={0.08} />
        <polyline points={g.linePoints} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />

        {/* Direct label on the one point that matters: where it stands now. */}
        <circle
          cx={g.points[g.points.length - 1].cx}
          cy={g.points[g.points.length - 1].cy}
          r={4}
          fill={stroke}
          stroke="#ffffff"
          strokeWidth={2}
        />

        {hovered && (
          <g pointerEvents="none">
            <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + PLOT_H} stroke={MUTED} strokeWidth={1} />
            <circle cx={hoverX} cy={g.yForCents(hovered.remainingCents)} r={4} fill={stroke} stroke="#ffffff" strokeWidth={2} />
          </g>
        )}
      </svg>

      {hovered && (
        // Values lead, labels follow; each series keyed by a short stroke
        // rather than a filled box.
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm"
          style={{
            left: `${(hoverX / VIEW_W) * 100}%`,
            transform: hoverX > VIEW_W / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          }}
        >
          <p className="font-medium text-slate-500">Day {hovered.day}</p>
          <p className="mt-1 flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: hovered.remainingCents < 0 ? OVER : ACCENT }} />
            <span className="font-semibold text-slate-900" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatCents(hovered.remainingCents)}
            </span>
            <span className="text-slate-400">left</span>
          </p>
          <p className="mt-0.5 flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: MUTED }} />
            <span className="font-medium text-slate-700" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatCents(paceAtHover)}
            </span>
            <span className="text-slate-400">at even pace</span>
          </p>
          {hovered.spentCents > 0 && (
            <p className="mt-1 border-t border-slate-100 pt-1 text-slate-500">
              <span className="font-medium text-slate-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatCents(hovered.spentCents)}
              </span>{" "}
              spent that day
            </p>
          )}
        </div>
      )}
    </div>
  );
}
