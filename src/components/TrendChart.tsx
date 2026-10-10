"use client";
import { useMemo, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { Enquiry } from "@/lib/types";
import { canAnimate } from "./motion";

// Seven days of calls: in-hours vs after-hours bars, qualified as a brass line. If the scoped data has nothing
// in the last week (e.g. the September replay), the window ends on the most recent call instead.

const day = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10); // IST date

export function TrendChart({ enquiries, selectedDay, onDay, onSeries }: { enquiries: Enquiry[]; selectedDay: string | null; onDay: (d: string) => void; onSeries: (f: "inhours" | "after" | "QUALIFIED") => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const data = useMemo(() => {
    const latest = enquiries.length ? new Date(Math.max(...enquiries.map((e) => Date.parse(e.createdAt)))) : new Date();
    const end = Date.now() - latest.getTime() < 7 * 864e5 ? new Date() : latest;
    const days = Array.from({ length: 7 }, (_, i) => day(new Date(end.getTime() - (6 - i) * 864e5)));
    return days.map((d) => {
      const list = enquiries.filter((e) => day(new Date(e.createdAt)) === d);
      return {
        d,
        label: new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
        inHours: list.filter((e) => !e.afterHours).length,
        after: list.filter((e) => e.afterHours).length,
        qualified: list.filter((e) => e.qualificationStatus === "QUALIFIED" && !e.supersededBy).length,
      };
    });
  }, [enquiries]);
  const max = Math.max(4, ...data.map((d) => d.inHours + d.after));
  const W = 560;
  const H = 170;
  const bw = 34;
  const gap = (W - bw * 7) / 6;
  const y = (v: number) => H - (v / max) * (H - 16);
  const line = data.map((d, i) => `${i ? "L" : "M"} ${i * (bw + gap) + bw / 2} ${y(d.qualified)}`).join(" ");
  const total = data.reduce((s, d) => s + d.inHours + d.after, 0);

  useGSAP(
    () => {
      if (!canAnimate()) return;
      gsap.from("[data-bar]", { scaleY: 0, transformOrigin: "50% 100%", duration: 0.9, ease: "power3.out", stagger: 0.05 });
      const path = ref.current?.querySelector<SVGPathElement>("[data-line]");
      if (path) {
        const len = path.getTotalLength();
        gsap.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.4, ease: "power2.out", delay: 0.3 });
      }
    },
    { scope: ref, dependencies: [total] },
  );

  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H + 26}`} className="w-full" role="img" aria-label={`Calls over the last 7 days: ${total} in total`}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#f2ebe0" strokeOpacity="0.06" />
        ))}
        {data.map((d, i) => {
          const x = i * (bw + gap);
          const sel = selectedDay === d.d;
          return (
            <g key={d.d} onClick={() => onDay(d.d)} className="cursor-pointer" role="button" aria-label={`Show calls on ${d.label}`}>
              <title>{`${d.label}: ${d.inHours + d.after} calls (${d.after} after hours, ${d.qualified} qualified) — click to see them`}</title>
              <rect x={x - gap / 2} y="0" width={bw + gap} height={H + 24} fill={sel ? "#e0784a" : "#fff"} fillOpacity={sel ? 0.08 : 0} className="transition hover:fill-opacity-[0.04]" />
              <rect data-bar x={x} y={y(d.inHours)} width={bw} height={H - y(d.inHours)} rx="6" fill="#f2ebe0" fillOpacity="0.16" />
              <rect data-bar x={x} y={y(d.inHours + d.after)} width={bw} height={y(d.inHours) - y(d.inHours + d.after)} rx="6" fill="#e0784a" fillOpacity="0.85" />
              <text x={x + bw / 2} y={H + 18} textAnchor="middle" fontSize="11" fill="#8d8274">
                {d.label}
              </text>
              {d.inHours + d.after > 0 && (
                <text x={x + bw / 2} y={y(d.inHours + d.after) - 6} textAnchor="middle" fontSize="11" fill="#c9bfb1" className="num">
                  {d.inHours + d.after}
                </text>
              )}
            </g>
          );
        })}
        <path data-line d={line} fill="none" stroke="#cfa96b" strokeWidth="2" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={d.d} cx={i * (bw + gap) + bw / 2} cy={y(d.qualified)} r="3.5" fill="#0e0c0a" stroke="#cfa96b" strokeWidth="2" />
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-ink-2">
        <button className="link-stat inline-flex items-center gap-1.5" onClick={() => onSeries("inhours")}><span className="h-2.5 w-2.5 rounded-sm bg-[#f2ebe0]/25" />In studio hours</button>
        <button className="link-stat inline-flex items-center gap-1.5" onClick={() => onSeries("after")}><span className="h-2.5 w-2.5 rounded-sm bg-brand" />After hours — answered by AI</button>
        <button className="link-stat inline-flex items-center gap-1.5" onClick={() => onSeries("QUALIFIED")}><span className="h-0.5 w-4 bg-brass" />Qualified</button>
      </div>
    </div>
  );
}
