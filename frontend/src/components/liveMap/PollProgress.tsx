import { useEffect, useRef, useState } from "react";

interface PollProgressProps {
  /** Length of one poll cycle, in ms. */
  intervalMs: number;
  /** Bump this whenever fresh data arrives — the ring snaps back to empty. */
  cycle: number;
  /** Ring stroke colour. */
  color?: string;
}

/**
 * A small ring that fills over one polling interval and resets to empty each
 * time new vehicle positions arrive, so the map has a visible "next update in…"
 * indicator.
 */
export default function PollProgress({ intervalMs, cycle, color = "#0693E3" }: PollProgressProps) {
  const [progress, setProgress] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setProgress(Math.min(1, (now - startRef.current) / intervalMs));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cycle, intervalMs]);

  const size = 22;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const secondsLeft = Math.max(0, Math.ceil(((1 - progress) * intervalMs) / 1000));

  return (
    <div
      className="poll-progress"
      title={`Live positions refresh every ${intervalMs / 1000}s — next in ${secondsLeft}s`}
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ring-track, rgba(0,0,0,0.12))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </div>
  );
}
