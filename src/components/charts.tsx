"use client";

import * as React from "react";
import { formatBytes } from "@/lib/utils";

const W = 420;
const H = 190;
const PAD = { l: 8, r: 8, t: 14, b: 26 };

function useHover(count: number, mode: "point" | "slot" = "point") {
  const [idx, setIdx] = React.useState<number | null>(null);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W - PAD.l;
    const raw = mode === "point" ? Math.round(x / ((W - PAD.l - PAD.r) / Math.max(1, count - 1))) : Math.floor(x / ((W - PAD.l - PAD.r) / count));
    setIdx(Math.max(0, Math.min(count - 1, raw)));
  };
  return { idx, onMove, onLeave: () => setIdx(null) };
}

const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function XAxis({ dates }: { dates: string[] }) {
  const n = dates.length;
  const ticks = [0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const step = (W - PAD.l - PAD.r) / Math.max(1, n - 1);
  return (
    <>
      {ticks.map((i) => (
        <text key={i} x={PAD.l + i * step} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-faint text-[12px]">
          {dayLabel(dates[i])}
        </text>
      ))}
    </>
  );
}

export function StorageChart({ data }: { data: { date: string; bytes: number }[] }) {
  const id = React.useId();
  const { idx, onMove, onLeave } = useHover(data.length);
  const max = Math.max(1, ...data.map((d) => d.bytes));
  const step = (W - PAD.l - PAD.r) / Math.max(1, data.length - 1);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const pts = data.map((d, i) => [PAD.l + i * step, y(d.bytes)] as const);
  const line = pts.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${pts.at(-1)![0]},${H - PAD.b} L${pts[0][0]},${H - PAD.b} Z`;
  const active = idx !== null ? data[idx] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-pan-y"
        role="img"
        aria-label={`Storage used over the last ${data.length} days, currently ${formatBytes(data.at(-1)?.bytes ?? 0)}`}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} stroke="#e3e6f0" strokeDasharray="3 4" />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#cfd4e4" />
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke="#4f46e5" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <XAxis dates={data.map((d) => d.date)} />
        {idx !== null && (
          <>
            <line x1={pts[idx][0]} x2={pts[idx][0]} y1={PAD.t} y2={H - PAD.b} stroke="#8c94ae" strokeDasharray="3 3" />
            <circle cx={pts[idx][0]} cy={pts[idx][1]} r="4.5" fill="#fff" stroke="#4f46e5" strokeWidth="2.2" />
          </>
        )}
      </svg>
      {active && idx !== null && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop"
          style={{ left: `${Math.min(88, Math.max(12, (pts[idx][0] / W) * 100))}%` }}
        >
          <div className="font-medium text-ink tabular-nums">{formatBytes(active.bytes)}</div>
          <div className="text-faint">{dayLabel(active.date)}</div>
        </div>
      )}
    </div>
  );
}

export function ActivityChart({ data }: { data: { date: string; uploads: number; failed: number }[] }) {
  const { idx, onMove, onLeave } = useHover(data.length, "slot");
  const max = Math.max(3, ...data.map((d) => d.uploads + d.failed));
  const slot = (W - PAD.l - PAD.r) / data.length;
  const bw = Math.max(3, slot * 0.62);
  const h = H - PAD.t - PAD.b;
  const active = idx !== null ? data[idx] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-pan-y"
        role="img"
        aria-label={`Uploads per day over the last ${data.length} days`}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * h} y2={PAD.t + f * h} stroke="#e3e6f0" strokeDasharray="3 4" />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#cfd4e4" />
        {data.map((d, i) => {
          const x = PAD.l + i * slot + (slot - bw) / 2;
          const hu = (d.uploads / max) * h;
          const hf = (d.failed / max) * h;
          return (
            <g key={d.date} opacity={idx === null || idx === i ? 1 : 0.45}>
              <rect x={x} y={H - PAD.b - hu} width={bw} height={Math.max(0, hu)} rx="2" fill="#4f46e5" />
              {d.failed > 0 && <rect x={x} y={H - PAD.b - hu - hf} width={bw} height={hf} rx="2" fill="#d6342f" />}
            </g>
          );
        })}
        <XAxis dates={data.map((d) => d.date)} />
      </svg>
      {active && idx !== null && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop"
          style={{ left: `${Math.min(88, Math.max(12, ((PAD.l + (idx + 0.5) * slot) / W) * 100))}%` }}
        >
          <div className="text-faint">{dayLabel(active.date)}</div>
          <div className="font-medium text-ink tabular-nums">{active.uploads} uploaded</div>
          {active.failed > 0 && <div className="text-danger tabular-nums">{active.failed} failed</div>}
        </div>
      )}
    </div>
  );
}
