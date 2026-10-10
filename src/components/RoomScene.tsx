"use client";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { Enquiry } from "@/lib/types";
import { cls, projectText } from "./ui";
import { canAnimate, finishAfter } from "./motion";

gsap.registerPlugin(useGSAP);

// An isometric "aangan" (courtyard) room drawn in SVG: plaster walls, a courtyard arch, a window throwing a
// shaft of light, oak floor, rug, sofa, pendant and a plant. The latest enquiries float in front as glass cards.
// Layers drift with the mouse (parallax) and breathe on loops — all GSAP, all honours reduced-motion.

const S = 22; // iso unit
const CX = 300;
const CY = 190; // keeps walls (6.4 high) and the floor corner inside the 600×420 canvas
const iso = (x: number, y: number, z: number) => [CX + (x - y) * 0.866 * S, CY + (x + y) * 0.5 * S - z * S];
const pts = (...p: [number, number, number][]) => p.map((q) => iso(...q).map((v) => v.toFixed(1)).join(",")).join(" ");

function Box({ x0, x1, y0, y1, z0, z1, top, left, right }: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; top: string; left: string; right: string }) {
  return (
    <g>
      <polygon points={pts([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1])} fill={left} />
      <polygon points={pts([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])} fill={right} />
      <polygon points={pts([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])} fill={top} />
    </g>
  );
}

function arch(cy: number, z0: number, z1: number, w: number) {
  // arch on the left wall (x = 0), centred at y = cy
  const steps = 18;
  const p: [number, number, number][] = [[0, cy - w, z0]];
  const spring = z1 - w;
  p.push([0, cy - w, spring]);
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - (i / steps) * Math.PI;
    p.push([0, cy + Math.cos(a) * w, spring + Math.sin(a) * w]);
  }
  p.push([0, cy + w, z0]);
  return pts(...p);
}

export function RoomScene({ latest, onOpen }: { latest: Enquiry[]; onOpen: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!canAnimate()) return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-room='floor']", { opacity: 0, y: 30, duration: 1.1 })
        .from("[data-room='wall']", { opacity: 0, y: -24, duration: 1, stagger: 0.12 }, "<0.1")
        .from("[data-room='prop']", { opacity: 0, y: 18, scale: 0.96, transformOrigin: "50% 100%", duration: 0.8, stagger: 0.08 }, "<0.35")
        .from("[data-room='beam']", { opacity: 0, duration: 1.4 }, "<0.2")
        .from("[data-card]", { opacity: 0, y: 26, rotateX: -18, duration: 0.9, stagger: 0.14 }, "<0.1");
      const stopSafety = finishAfter(tl, 3500);
      gsap.to("[data-room='beam']", { opacity: 0.55, duration: 3.2, yoyo: true, repeat: -1, ease: "sine.inOut" });
      gsap.to("[data-room='glow']", { scale: 1.12, opacity: 0.8, transformOrigin: "50% 50%", duration: 2.6, yoyo: true, repeat: -1, ease: "sine.inOut" });
      gsap.utils.toArray<HTMLElement>("[data-card]").forEach((el, i) => {
        gsap.to(el, { y: i % 2 ? -9 : 9, duration: 3 + i * 0.6, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 1.2 + i * 0.3 });
      });
      // parallax: room, props and cards move different amounts
      const el = root.current!;
      const qx = [gsap.quickTo("[data-depth='1']", "x", { duration: 0.8 }), gsap.quickTo("[data-depth='2']", "x", { duration: 0.8 }), gsap.quickTo("[data-depth='3']", "x", { duration: 0.8 })];
      const qy = [gsap.quickTo("[data-depth='1']", "y", { duration: 0.8 }), gsap.quickTo("[data-depth='2']", "y", { duration: 0.8 }), gsap.quickTo("[data-depth='3']", "y", { duration: 0.8 })];
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        [6, 14, 26].forEach((d, i) => {
          qx[i](nx * d);
          qy[i](ny * d * 0.6);
        });
      };
      el.addEventListener("pointermove", move);
      return () => {
        stopSafety();
        el.removeEventListener("pointermove", move);
      };
    },
    { scope: root },
  );

  const cards = latest.slice(0, 3);
  // the four corners outside the room are empty — cards live there so the room stays visible
  const pos = ["left-0 top-[3%]", "right-0 top-[8%]", "right-[1%] bottom-[3%]"];

  return (
    <div ref={root} className="relative h-[360px] w-full select-none md:h-[420px]" style={{ perspective: 900 }}>
      <svg viewBox="0 0 600 420" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="wallL" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--room-wall-l1)" }} />
            <stop offset="1" style={{ stopColor: "var(--room-wall-l2)" }} />
          </linearGradient>
          <linearGradient id="wallR" x1="1" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--room-wall-r1)" }} />
            <stop offset="1" style={{ stopColor: "var(--room-wall-r2)" }} />
          </linearGradient>
          <linearGradient id="floor" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--room-floor1)" }} />
            <stop offset="1" style={{ stopColor: "var(--room-floor2)" }} />
          </linearGradient>
          <linearGradient id="beam" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffd9a8" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffd9a8" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="glow">
            <stop offset="0" stopColor="#ffcf8f" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffcf8f" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="court" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#e9a06d" />
            <stop offset="1" stopColor="#7a3f22" />
          </linearGradient>
          <pattern id="planks" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="skewX(-30) rotate(26)">
            <rect width="14" height="14" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="14" style={{ stroke: "var(--room-plank)" }} strokeOpacity="0.18" strokeWidth="1" />
          </pattern>
        </defs>

        <g data-depth="1">
          {/* floor */}
          <g data-room="floor">
            <polygon points={pts([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0])} fill="url(#floor)" />
            <polygon points={pts([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0])} fill="url(#planks)" />
            <polygon points={pts([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0])} fill="none" style={{ stroke: "var(--room-edge)" }} strokeOpacity="0.12" />
          </g>
          {/* walls */}
          <g data-room="wall">
            <polygon points={pts([0, 0, 0], [0, 10, 0], [0, 10, 6.4], [0, 0, 6.4])} fill="url(#wallL)" />
            {/* courtyard arch — the "aangan" glimpsed beyond */}
            <polygon points={arch(5.2, 0, 5, 1.7)} fill="url(#court)" opacity="0.9" />
            <polygon points={arch(5.2, 0, 5, 1.7)} fill="none" stroke="#cfa96b" strokeOpacity="0.5" strokeWidth="1.2" />
          </g>
          <g data-room="wall">
            <polygon points={pts([0, 0, 0], [10, 0, 0], [10, 0, 6.4], [0, 0, 6.4])} fill="url(#wallR)" />
            {/* window */}
            <polygon points={pts([3.2, 0, 2.2], [7.2, 0, 2.2], [7.2, 0, 5.4], [3.2, 0, 5.4])} style={{ fill: "var(--room-window)" }} />
            <polygon points={pts([3.2, 0, 2.2], [7.2, 0, 2.2], [7.2, 0, 5.4], [3.2, 0, 5.4])} fill="none" stroke="#cfa96b" strokeOpacity="0.6" strokeWidth="1.2" />
            <line x1={iso(5.2, 0, 2.2)[0]} y1={iso(5.2, 0, 2.2)[1]} x2={iso(5.2, 0, 5.4)[0]} y2={iso(5.2, 0, 5.4)[1]} stroke="#cfa96b" strokeOpacity="0.5" />
            {/* framed art */}
            <polygon points={pts([0.8, 0, 3], [2.2, 0, 3], [2.2, 0, 4.6], [0.8, 0, 4.6])} fill="#e0784a" opacity="0.75" />
          </g>
          {/* light shaft from the window onto the floor */}
          <polygon data-room="beam" opacity="0.32" points={pts([3.2, 0, 5.4], [7.2, 0, 5.4], [9.6, 4.8, 0], [5.6, 4.8, 0])} fill="url(#beam)" />
        </g>

        <g data-depth="2">
          {/* rug */}
          <polygon data-room="prop" points={pts([3.2, 4.2, 0.02], [8.6, 4.2, 0.02], [8.6, 8.8, 0.02], [3.2, 8.8, 0.02])} fill="#9c4f2c" opacity="0.55" />
          <polygon data-room="prop" points={pts([3.6, 4.6, 0.03], [8.2, 4.6, 0.03], [8.2, 8.4, 0.03], [3.6, 8.4, 0.03])} fill="none" stroke="#cfa96b" strokeOpacity="0.45" strokeDasharray="3 3" />
          {/* sofa */}
          <g data-room="prop">
            <Box x0={4} x1={8.4} y0={8.2} y1={9.6} z0={0} z1={1} top="#c9b8a3" left="#8e7d69" right="#a8967f" />
            <Box x0={4} x1={8.4} y0={9.2} y1={9.6} z0={1} z1={2.1} top="#d8c8b4" left="#8e7d69" right="#b5a38c" />
            <Box x0={8.4} x1={8.9} y0={8.2} y1={9.6} z0={0} z1={1.5} top="#d8c8b4" left="#7f6f5c" right="#a08e78" />
          </g>
          {/* coffee table */}
          <g data-room="prop">
            <Box x0={5.2} x1={7.2} y0={5.6} y1={6.8} z0={0.5} z1={0.7} top="#e7dccd" left="#8a7a66" right="#b3a48f" />
            <Box x0={5.6} x1={6.8} y0={6} y1={6.4} z0={0} z1={0.5} top="#3a3027" left="#2a221b" right="#342a22" />
          </g>
          {/* plant */}
          <g data-room="prop">
            <Box x0={1} x1={1.9} y0={1} y1={1.9} z0={0} z1={1.1} top="#3b2f25" left="#cfa96b" right="#b08c55" />
            <ellipse cx={iso(1.45, 1.45, 2.3)[0]} cy={iso(1.45, 1.45, 2.3)[1]} rx="22" ry="26" fill="#5f7d5b" />
            <ellipse cx={iso(1.45, 1.45, 2.3)[0] - 10} cy={iso(1.45, 1.45, 2.3)[1] - 6} rx="12" ry="16" fill="#86a882" opacity="0.8" />
          </g>
        </g>

        <g data-depth="3">
          {/* pendant lamp */}
          <g data-room="prop">
            <line x1={iso(6.2, 7, 6.4)[0]} y1={iso(6.2, 7, 6.4)[1]} x2={iso(6.2, 7, 4.3)[0]} y2={iso(6.2, 7, 4.3)[1]} stroke="#cfa96b" strokeOpacity="0.7" />
            <circle data-room="glow" cx={iso(6.2, 7, 3.9)[0]} cy={iso(6.2, 7, 3.9)[1]} r="46" fill="url(#glow)" opacity="0.55" />
            <path d={`M ${iso(6.2, 7, 4.3)[0] - 16} ${iso(6.2, 7, 3.8)[1]} Q ${iso(6.2, 7, 4.3)[0]} ${iso(6.2, 7, 4.6)[1]} ${iso(6.2, 7, 4.3)[0] + 16} ${iso(6.2, 7, 3.8)[1]} Z`} fill="#cfa96b" />
          </g>
        </g>
      </svg>

      {/* floating enquiry cards */}
      <div data-depth="3" className="pointer-events-none absolute inset-0">
        {cards.map((e, i) => (
          <button key={e.id} data-card onClick={() => onOpen(e.id)} title={`Open ${e.callerName ?? "this enquiry"}`} className={cls("card card-glow lift pointer-events-auto absolute w-[176px] p-2.5 text-left md:w-[190px]", pos[i])} style={{ transformStyle: "preserve-3d" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-medium">{e.callerName ?? "New caller"}</span>
              <span className={cls("h-1.5 w-1.5 shrink-0 rounded-full", e.qualificationStatus === "QUALIFIED" ? "bg-ok" : e.qualificationStatus === "NOT_QUALIFIED" ? "bg-bad" : "bg-warn")} />
            </div>
            <div className="mt-0.5 truncate text-[12px] text-ink-2">{projectText(e) ?? "Enquiry"}</div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
              <span className="truncate">{e.location?.split(",")[0] ?? "—"}</span>
              <span className="font-mono">{e.qualificationStatus === "QUALIFIED" ? "→ designer" : e.qualificationStatus === "NEEDS_REVIEW" ? "review" : "closed"}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-[4%] left-0 flex items-center gap-2 text-[10.5px] tracking-[0.14em] text-muted uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-ok breathe" /> Latest enquiries
      </div>
    </div>
  );
}
