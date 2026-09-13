import { useState, useEffect, useRef, useCallback } from 'react';

/** Fires `onEnter` once, the first time `ref`'s element scrolls into view. */
function useOnScreen<T extends Element>(onEnter: () => void, opts: IntersectionObserverInit = { threshold: 0.4 }) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { onEnter(); obs.disconnect(); }
    }, opts);
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

// ─── Reveal (up / left / right / scale / fade) ────────────────────────────────

export type RevealDir = 'up' | 'left' | 'right' | 'scale' | 'fade';

function getRevealFrom(dir: RevealDir): string {
  if (dir === 'left') return 'translateX(-28px)';
  if (dir === 'right') return 'translateX(28px)';
  if (dir === 'scale') return 'scale(0.94)';
  if (dir === 'fade') return 'none';
  return 'translateY(20px)';
}

export function Reveal({
  children, delay = 0, className = '', dir = 'up', as: Tag = 'div',
}: {
  children: React.ReactNode; delay?: number; className?: string; dir?: RevealDir; as?: React.ElementType;
}) {
  const [on, setOn] = useState(false);
  const ref = useOnScreen<HTMLElement>(() => setOn(true), { threshold: 0.06, rootMargin: '0px 0px -32px 0px' });
  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        opacity: on ? 1 : 0,
        transform: on ? 'none' : getRevealFrom(dir),
        transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
      }}
    >
      {children}
    </Tag>
  );
}

// ─── Count up ─────────────────────────────────────────────────────────────────

export function useCountUp(target: number, duration = 1200) {
  const [revealed, setRevealed] = useState(false);
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  const ref = useOnScreen<HTMLElement>(() => setRevealed(true), { threshold: 0.5 });
  useEffect(() => {
    if (!revealed) return;
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setVal(from + ease * (target - from));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Re-animate from the last value whenever `target` changes (e.g. a live simulation), not just on first reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, target, duration]);
  return { ref, val };
}

/** Animates 0 → value, formatting each frame with `format` (reuse `mxn`, `compact`, etc). */
export function AnimatedNumber({
  value, format, duration = 1200, className = '', as: Tag = 'span',
}: {
  value: number; format: (v: number) => string; duration?: number; className?: string; as?: React.ElementType;
}) {
  const { ref, val } = useCountUp(value, duration);
  return (
    <Tag ref={ref as React.RefObject<HTMLElement>} className={className}>
      {format(val)}
    </Tag>
  );
}

export function CountNum({ value, prefix = '', suffix = '', className = '' }: { value: number; prefix?: string; suffix?: string; className?: string }) {
  const { ref, val } = useCountUp(value);
  const abs = Math.abs(Math.round(val));
  const formatted = abs >= 1000 ? abs.toLocaleString('es-MX') : String(abs);
  const sign = value < 0 ? '-' : '';
  return (
    <span ref={ref as React.RefObject<HTMLSpanElement>} className={className}>
      {sign}{prefix}{formatted}{suffix}
    </span>
  );
}

// ─── Draw-in for SVG polylines / paths ─────────────────────────────────────────

export function DrawPolyline({ delay = 0, ...rest }: React.SVGProps<SVGPolylineElement> & { delay?: number }) {
  const [drawn, setDrawn] = useState(false);
  const [len, setLen] = useState(0);
  const setRef = useCallback((el: SVGPolylineElement | null) => {
    if (!el) return;
    setLen((el as SVGGeometryElement).getTotalLength?.() ?? 400);
  }, []);
  const obsRef = useOnScreen<SVGPolylineElement>(() => setDrawn(true), { threshold: 0.1 });
  return (
    <polyline
      ref={(el) => { setRef(el); (obsRef as React.MutableRefObject<SVGPolylineElement | null>).current = el; }}
      strokeDasharray={len || undefined}
      strokeDashoffset={drawn ? 0 : (len || undefined)}
      style={{ transition: drawn ? `stroke-dashoffset 1.2s ease ${delay}ms` : 'none' }}
      {...rest}
    />
  );
}

/** Same draw-in technique as `DrawPolyline`, for an SVG `<path>` (e.g. a gauge arc). */
export function DrawPath({ delay = 0, ...rest }: React.SVGProps<SVGPathElement> & { delay?: number }) {
  const [drawn, setDrawn] = useState(false);
  const [len, setLen] = useState(0);
  const setRef = useCallback((el: SVGPathElement | null) => {
    if (!el) return;
    setLen((el as SVGGeometryElement).getTotalLength?.() ?? 300);
  }, []);
  const obsRef = useOnScreen<SVGPathElement>(() => setDrawn(true), { threshold: 0.1 });
  return (
    <path
      ref={(el) => { setRef(el); (obsRef as React.MutableRefObject<SVGPathElement | null>).current = el; }}
      strokeDasharray={len || undefined}
      strokeDashoffset={drawn ? 0 : (len || undefined)}
      style={{ transition: drawn ? `stroke-dashoffset 1s ease ${delay}ms` : 'none' }}
      {...rest}
    />
  );
}

// ─── Bar reveal (width 0 → pct on scroll into view) ────────────────────────────

export function BarReveal({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  const [revealed, setRevealed] = useState(false);
  const [w, setW] = useState(0);
  const ref = useOnScreen<HTMLDivElement>(() => setRevealed(true), { threshold: 0.5 });
  useEffect(() => { if (revealed) setW(pct); }, [revealed, pct]);
  return (
    <div ref={ref} className="flex-1 overflow-hidden rounded-full bg-ash/10" style={{ height }}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, w))}%`, background: color, transition: 'width 1s ease 150ms' }} />
    </div>
  );
}

// ─── Tilt card (mouse-follow 3D tilt) ───────────────────────────────────────────

export function TiltCard({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${x * 6}deg) rotateX(${-y * 4}deg)`;
  }, []);
  const reset = useCallback(() => {
    if (ref.current) ref.current.style.transform = 'perspective(900px) rotateY(0deg) rotateX(0deg)';
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{ ...style, transformStyle: 'preserve-3d', transition: 'transform 0.3s ease' }}
      onMouseMove={handleMove}
      onMouseLeave={reset}
    >
      {children}
    </div>
  );
}
