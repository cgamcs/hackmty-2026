/** Half-ring gauge for the 0–100 Health Score. */
export function HealthGauge({ score, resilience }: { score: number; resilience: number }) {
  const cx = 90;
  const cy = 108;
  const r = 72;
  const angle = Math.PI - (Math.min(100, Math.max(0, score)) / 100) * Math.PI;
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);

  return (
    <div className="relative flex flex-1 items-center justify-center" role="img" aria-label={`Health Score ${score} de 100, Resilience ${resilience}`}>
      <svg width="180" height="120" viewBox="0 0 180 120" fill="none" aria-hidden="true">
        <path d={`M18 108a72 72 0 01144 0`} stroke="rgba(199,214,213,0.18)" strokeWidth="12" strokeLinecap="round" />
        <path d={`M18 108A72 72 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} stroke="#C20114" strokeWidth="12" strokeLinecap="round" />
        <circle cx={x} cy={y} r="7" fill="#C20114" stroke="#0C120C" strokeWidth="3" />
      </svg>
      <div className="absolute inset-x-0 bottom-1.5 text-center">
        <div className="num text-[40px] leading-none tracking-[-.03em]">
          {score}
          <span className="text-[17px] text-dim">/100</span>
        </div>
        <div className="mt-1.5 text-[11.5px] text-dim">Health Score · Resilience {resilience}</div>
      </div>
    </div>
  );
}
