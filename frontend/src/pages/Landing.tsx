import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Reveal, CountNum, DrawPolyline, TiltCard, BarReveal } from '@/components/animate';

// ─── Scroll progress ──────────────────────────────────────────────────────────

function useScrollProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const handle = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setPct(total > 0 ? Math.min(100, (window.scrollY / total) * 100) : 0);
    };
    window.addEventListener('scroll', handle, { passive: true });
    return () => window.removeEventListener('scroll', handle);
  }, []);
  return pct;
}

// ─── Keyframes injection ──────────────────────────────────────────────────────

function LandingAnimations() {
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'pnt-keyframes';
    style.textContent = `
      @keyframes pnt-ticker  { from{transform:translate3d(0,0,0)} to{transform:translate3d(-50%,0,0)} }
      @keyframes pnt-glow    { 0%,100%{opacity:.8;transform:translate3d(0,0,0) scale(1)} 50%{opacity:1;transform:translate3d(-2%,1.5%,0) scale(1.04)} }
      @keyframes pnt-blip    { 0%,100%{opacity:1} 50%{opacity:.2} }
      @keyframes pnt-floatA  { 0%,100%{transform:translate3d(0,0,0)} 50%{transform:translate3d(0,-10px,0)} }
      @keyframes pnt-floatB  { 0%,100%{transform:translate3d(0,0,0)} 50%{transform:translate3d(0,12px,0)} }
      .pnt-lift { transition: transform 0.25s ease, box-shadow 0.25s ease; }
      .pnt-lift:hover { transform: translateY(-5px); box-shadow: 0 24px 48px rgba(0,0,0,0.45); }
    `;
    document.head.appendChild(style);
    return () => document.getElementById('pnt-keyframes')?.remove();
  }, []);
  return null;
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
// Reveal / CountNum / DrawPolyline / TiltCard / BarReveal now live in @/components/animate,
// shared with the rest of the app.

const NAV_SECTIONS = [
  { label: 'El problema', id: 'problema' },
  { label: 'Cómo funciona', id: 'como' },
  { label: 'Producto', id: 'producto' },
  { label: 'Comparación', id: 'comparacion' },
  { label: 'Precio', id: 'precio' },
  { label: 'FAQ', id: 'faq' },
];

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState('');
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  useEffect(() => {
    const obs: IntersectionObserver[] = [];
    NAV_SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) setActive(id); }, { threshold: 0.35 });
      o.observe(el);
      obs.push(o);
    });
    return () => obs.forEach(o => o.disconnect());
  }, []);
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between gap-4 py-[18px]"
      style={{ background: 'linear-gradient(#0C120C 60%, rgba(12,18,12,0.86) 88%, rgba(12,18,12,0))' }}>
      <a href="#top" className="flex flex-none items-center gap-[10px] rounded-full border border-ash/20 px-5 py-0" style={{ height: 46 }}>
        <span className="size-[18px] rounded-[6px] bg-ember flex-none" />
        <span className="text-[18px] font-medium tracking-[-.01em]">Puente</span>
      </a>
      {scrolled && (
        <div className="hidden items-center gap-0.5 md:flex"
          style={{ height: 46, padding: '0 6px', borderRadius: 999, background: 'rgba(109,114,117,0.13)', border: '1px solid rgba(199,214,213,0.10)' }}>
          {NAV_SECTIONS.map(({ label, id }) => (
            <a key={id} href={`#${id}`} className="flex items-center whitespace-nowrap rounded-full px-[15px] text-[13px] transition-colors"
              style={{ height: 34, color: active === id ? '#ECEBF3' : '#6D7275', background: active === id ? 'rgba(199,214,213,0.10)' : 'none' }}>
              {label}
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-none items-center gap-2">
        {scrolled && (
          <Link to="/login" className="hidden items-center rounded-full border border-ash/18 px-[18px] text-[13.5px] text-ghost hover:border-ash/45 md:flex" style={{ height: 44 }}>
            Entrar
          </Link>
        )}
        <Link to="/login" className="flex items-center whitespace-nowrap rounded-full bg-ember px-5 text-[13.5px] font-medium text-ghost hover:bg-[#D9111F]" style={{ height: 44 }}>
          Subir CFDI
        </Link>
      </div>
    </nav>
  );
}

// ─── Hero chart ───────────────────────────────────────────────────────────────

function HeroChart() {
  const obsRef = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = obsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={obsRef} className="relative mt-3 rounded-[26px] p-[20px_18px_14px]"
      style={{ background: 'rgba(109,114,117,0.13)', border: '1px solid rgba(199,214,213,0.10)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3">
        <div className="font-mono text-[10px] uppercase tracking-[.12em] text-dim">Curva de caja · 30 días · esquema</div>
        <div className="flex flex-wrap items-center gap-[14px] font-mono text-[9.5px] uppercase tracking-[.12em] text-dim">
          <span className="flex items-center gap-[7px]"><span className="inline-block" style={{ width: 16, height: 2, background: '#C20114' }} />Esperado</span>
          <span className="flex items-center gap-[7px]"><span className="inline-block w-4" style={{ borderTop: '2px dashed #EF4444' }} />P20</span>
          <span className="flex items-center gap-[7px]"><span className="inline-block w-4" style={{ borderTop: '1px dashed rgba(199,214,213,0.5)' }} />Nómina</span>
        </div>
      </div>
      <svg viewBox="0 0 900 320" width="100%" style={{ display: 'block', overflow: 'visible' }}>
        {[60, 130, 200, 270].map(y => (
          <line key={y} x1="40" y1={y} x2="860" y2={y} stroke={y === 270 ? 'rgba(199,214,213,0.35)' : 'rgba(199,214,213,0.14)'} strokeWidth="1" />
        ))}
        {/* fill band */}
        <polygon
          points="40,96 94,108 148,124 202,146 256,168 310,190 364,214 418,232 472,220 526,196 580,172 634,150 688,128 742,108 796,88 850,72 850,160 796,172 742,186 688,200 634,216 580,232 526,250 472,268 418,276 364,254 310,226 256,200 202,174 148,146 94,122 40,104"
          fill="rgba(239,68,68,0.15)"
          style={{ opacity: vis ? 1 : 0, transition: 'opacity 0.8s ease 500ms' }}
        />
        {/* nómina */}
        <line x1="40" y1="250" x2="860" y2="250" stroke="rgba(199,214,213,0.5)" strokeWidth="1" strokeDasharray="5 7" />
        {/* P20 */}
        <polyline
          points="40,104 94,122 148,146 202,174 256,200 310,226 364,254 418,276 472,268 526,250 580,232 634,216 688,200 742,186 796,172 850,160"
          fill="none" stroke="#EF4444" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round"
          style={{ opacity: vis ? 1 : 0, transition: 'opacity 0.7s ease 700ms' }}
        />
        {/* expected — drawn */}
        <DrawPolyline
          points="40,96 94,108 148,124 202,146 256,168 310,190 364,214 418,232 472,220 526,196 580,172 634,150 688,128 742,108 796,88 850,72"
          fill="none" stroke="#C20114" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" delay={200}
        />
        {/* breach dots */}
        <circle cx="418" cy="232" r="6" fill="#EF4444" style={{ opacity: vis ? 1 : 0, transition: 'opacity 0.5s ease 1500ms' }} />
        <circle cx="418" cy="276" r="4.5" fill="#EF4444" opacity="0.5" style={{ opacity: vis ? 0.5 : 0, transition: 'opacity 0.5s ease 1600ms' }} />
        {['HOY', 'DÍA 8', 'DÍA 15', 'DÍA 22', 'DÍA 30'].map((label, i) => {
          const xPos = [40, 230, 396, 600, 800][i];
          const color = label === 'DÍA 15' ? '#C20114' : '#6D7275';
          return <text key={label} x={xPos} y="298" fill={color} fontFamily="'IBM Plex Mono',monospace" fontSize="11" letterSpacing="1.4">{label}</text>;
        })}
      </svg>
      {/* breach callout */}
      <div className="pointer-events-none absolute" style={{ left: '46.4%', top: '20%', transform: 'translateX(-50%)', opacity: vis ? 1 : 0, transition: 'opacity 0.6s ease 1700ms' }}>
        <div className="whitespace-nowrap rounded-[14px] text-center"
          style={{ background: '#060906', border: '1px solid rgba(239,68,68,0.45)', padding: '10px 14px', boxShadow: '0 18px 40px rgba(0,0,0,0.6)' }}>
          <div className="font-mono text-[9.5px] uppercase tracking-[.12em] text-dim">Mínimo proyectado</div>
          <div className="mt-1 text-[15px] text-alto num">-$25,300 · 15 sep</div>
        </div>
      </div>
    </div>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section id="top" style={{ position: 'relative', padding: 'clamp(34px,6vw,84px) 0 0', textAlign: 'center' }}>
      <Reveal>
        <div className="inline-flex items-center gap-[10px]"
          style={{ height: 32, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(199,214,213,0.16)', background: 'rgba(109,114,117,0.13)' }}>
          <span className="size-[7px] rounded-full bg-ember" style={{ animation: 'pnt-blip 2.4s ease-in-out infinite' }} />
          <span className="font-mono text-[10.5px] uppercase tracking-[.12em] text-dim">Working capital intelligence · México</span>
        </div>
      </Reveal>

      <h1 style={{ margin: '26px auto 0', maxWidth: 1000, fontSize: 'clamp(38px,6.4vw,72px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.0, textWrap: 'balance' } as React.CSSProperties}>
        <Reveal delay={60} as="span" className="block">Sabes cuánto vendiste.</Reveal>
        <Reveal delay={170} as="span" className="block text-dim">Puente te dice cuánto</Reveal>
        <Reveal delay={260} as="span" className="block">vas a tener el día 15.</Reveal>
      </h1>

      <Reveal delay={360}>
        <p style={{ margin: '28px auto 0', maxWidth: 620, fontSize: 'clamp(14.5px,1.4vw,16.5px)', lineHeight: 1.6, color: '#C7D6D5', textWrap: 'pretty' } as React.CSSProperties}>
          Sube el ZIP de CFDI de tu portal SAT y elige tu cuenta operativa. Puente reconcilia facturas contra movimientos, aprende cuándo paga cada cliente y proyecta tu liquidez a 30 días — con la banda pesimista puesta.
        </p>
      </Reveal>

      <Reveal delay={430}>
        <div className="mt-[34px] flex flex-wrap items-center justify-center gap-[10px]">
          <Link to="/login" className="flex items-center gap-3 rounded-full bg-ember font-medium text-ghost hover:bg-[#D9111F]"
            style={{ height: 54, paddingLeft: 26, paddingRight: 12, fontSize: 15 }}>
            Sube tu ZIP de CFDI
            <span className="flex size-8 items-center justify-center rounded-full" style={{ background: 'rgba(12,18,12,0.28)' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#ECEBF3" strokeWidth="1.5"><path d="M3 8h9.5"/><path d="M8.8 4.3L13 8l-4.2 3.7"/></svg>
            </span>
          </Link>
          <a href="#producto" className="flex items-center rounded-full border border-ash/20 text-ghost hover:border-ash/45"
            style={{ height: 54, padding: '0 26px', fontSize: 15 }}>
            Ver el producto
          </a>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-4 font-mono text-[10.5px] uppercase tracking-[.12em] text-dim">
          <span>Tu curva en 5 min</span><span className="opacity-40">/</span>
          <span>Sin API keys</span><span className="opacity-40">/</span>
          <span>Sin contraseñas bancarias</span><span className="opacity-40">/</span>
          <span>Sin tarjeta</span>
        </div>
      </Reveal>

      {/* Hero card with tilt + satellites */}
      <Reveal delay={480} dir="scale">
        <div className="relative mt-[clamp(40px,5.6vw,72px)]">
          {/* glow orb */}
          <div className="absolute pointer-events-none"
            style={{ inset: '-8% -6% 26% -6%', borderRadius: '50%', background: 'radial-gradient(58% 58% at 72% 18%, rgba(109,114,117,0.32), rgba(12,18,12,0) 70%)', filter: 'blur(10px)', animation: 'pnt-glow 10s ease-in-out infinite' }} />

          {/* Satellite left — breach alert */}
          <div className="absolute hidden xl:block" style={{ left: -18, top: '20%', zIndex: 2 }}>
            <div style={{ animation: 'pnt-floatA 7s ease-in-out infinite' }}>
              <div className="rounded-[20px] p-[16px_18px] text-left"
                style={{ background: '#060906', border: '1px solid rgba(199,214,213,0.14)', boxShadow: '0 30px 60px rgba(0,0,0,0.6)', maxWidth: 250 }}>
                <div className="flex items-center gap-[9px]">
                  <span className="size-[7px] rounded-full bg-alto" style={{ animation: 'pnt-blip 2s ease-in-out infinite' }} />
                  <span className="font-mono text-[9.5px] uppercase tracking-[.12em] text-dim">Breach alert · día 11</span>
                </div>
                <div className="mt-[10px] text-[14px] leading-[1.45]">El 15 te faltan <span className="text-alto num">$25,300</span> para la nómina.</div>
              </div>
            </div>
          </div>

          {/* Satellite right — recovery */}
          <div className="absolute hidden xl:block" style={{ right: -20, bottom: '12%', zIndex: 2 }}>
            <div style={{ animation: 'pnt-floatB 8.5s ease-in-out infinite' }}>
              <div className="rounded-[20px] p-[16px_18px] text-left"
                style={{ background: '#060906', border: '1px solid rgba(199,214,213,0.14)', boxShadow: '0 30px 60px rgba(0,0,0,0.6)', maxWidth: 260 }}>
                <div className="font-mono text-[9.5px] uppercase tracking-[.12em] text-dim">Recovery · escalón 1</div>
                <div className="mt-[10px] text-[14px] leading-[1.45]">Cobra A-4471 a Ferretería López 4 días antes.</div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="flex items-center rounded-full bg-ember text-[11.5px]" style={{ height: 26, padding: '0 12px' }}>Costo $0</span>
                  <span className="font-mono text-[9.5px] uppercase tracking-[.12em] text-dim">paga en 4d</span>
                </div>
              </div>
            </div>
          </div>

          {/* Main product card with 3D tilt */}
          <TiltCard style={{ borderRadius: 34, border: '1px solid rgba(199,214,213,0.13)', boxShadow: '0 50px 120px rgba(0,0,0,0.7)', background: 'radial-gradient(120% 90% at 80% 0%, rgba(109,114,117,0.26) 0%, rgba(109,114,117,0.10) 42%, rgba(12,18,12,0) 72%), #0C120C', padding: 'clamp(14px,2vw,22px)', textAlign: 'left', position: 'relative' }}>
            {/* mini nav */}
            <div className="flex items-center justify-between gap-[14px]">
              <div className="flex items-center gap-[9px]">
                <span className="size-[14px] rounded-[5px] bg-ember" />
                <span className="text-[14px] font-medium tracking-[-.01em]">Puente</span>
              </div>
              <div className="hidden items-center gap-0.5 overflow-hidden sm:flex"
                style={{ height: 36, padding: '0 5px', borderRadius: 999, background: 'rgba(109,114,117,0.14)', border: '1px solid rgba(199,214,213,0.10)' }}>
                {['Inicio', 'Predicción', 'Stress Lab', 'Recovery'].map((t, i) => (
                  <span key={t} className="flex items-center whitespace-nowrap rounded-full px-[14px] text-[11.5px]"
                    style={{ height: 26, background: i === 0 ? '#C20114' : 'none', color: i === 0 ? '#ECEBF3' : '#6D7275' }}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-[6px]">
                <span className="size-8 rounded-full border border-ash/18" />
                <span className="flex size-8 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ background: 'rgba(109,114,117,0.30)', border: '1px solid rgba(199,214,213,0.18)' }}>MV</span>
              </div>
            </div>
            {/* KPI row */}
            <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))' }}>
              {[
                { label: 'Caja hoy', value: 412880, prefix: '$', color: '#ECEBF3', dark: false },
                { label: 'Mínimo · día 15', value: -25300, prefix: '$', color: '#EF4444', dark: true },
                { label: 'Por cobrar <30d', value: 768400, prefix: '$', color: '#ECEBF3', dark: false },
              ].map(({ label, value, prefix, color, dark }) => (
                <div key={label} className="rounded-[26px] p-[18px_20px]"
                  style={{ background: dark ? '#060906' : 'rgba(109,114,117,0.13)', border: '1px solid rgba(199,214,213,0.10)' }}>
                  <div className="font-mono text-[10px] uppercase tracking-[.12em] text-dim">{label}</div>
                  <div className="num mt-[10px] leading-none tracking-[-.035em]" style={{ fontSize: 'clamp(26px,3vw,40px)', color }}>
                    <CountNum value={value} prefix={prefix} />
                  </div>
                </div>
              ))}
            </div>
            <HeroChart />
          </TiltCard>
        </div>
      </Reveal>
    </section>
  );
}

// ─── Ticker ───────────────────────────────────────────────────────────────────

const TICKER_ITEMS = [
  'CFDI 4.0 · SAT', 'PPD · net-30', 'Reconciliación CFDI ↔ banco', 'Learned payment terms',
  'Forecast 30d', 'Banda P20', 'Breach classifier', 'Recovery ladder',
  'DSO por cliente', 'Stress Lab', 'Capital One Nessie API', 'MXN',
];

function Ticker() {
  return (
    <div className="mt-[clamp(36px,5vw,64px)] overflow-hidden"
      style={{ padding: '18px 0', borderTop: '1px solid rgba(199,214,213,0.10)', borderBottom: '1px solid rgba(199,214,213,0.10)' }}>
      <div className="flex w-max font-mono text-[10.5px] uppercase tracking-[.14em] text-dim" style={{ animation: 'pnt-ticker 38s linear infinite' }}>
        {[0, 1].map(rep => (
          <div key={rep} className="flex gap-[40px] pr-[40px]">
            {TICKER_ITEMS.map(item => <span key={item}>{item}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat band ────────────────────────────────────────────────────────────────

const STATS = [
  { value: 30, suffix: ' días', color: '#ECEBF3', label: 'Horizonte de proyección' },
  { value: 4, suffix: ' días', color: '#C20114', label: 'Aviso antes del breach*' },
  { value: 45, suffix: '%', color: '#ECEBF3', label: 'APR de la tarjeta que evitas' },
  { value: 5, suffix: ' min', color: '#ECEBF3', label: 'Del ZIP a la curva' },
];

function StatBand() {
  return (
    <div style={{ padding: 'clamp(52px,7vw,96px) 0 0' }}>
      <div className="grid gap-[clamp(20px,3vw,36px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))' }}>
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 90}>
            <div className="num leading-none tracking-[-.035em]" style={{ fontSize: 'clamp(38px,5vw,62px)', fontWeight: 400, color: s.color }}>
              <CountNum value={s.value} suffix={s.suffix} />
            </div>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-[.12em] text-dim">{s.label}</div>
          </Reveal>
        ))}
      </div>
      <Reveal>
        <p className="mt-[26px] text-[12px] leading-relaxed text-dim" style={{ maxWidth: 620 }}>
          *Margen medio entre la detección del breach y la fecha de nómina en los escenarios de prueba del motor. Cifras del producto sobre datos de demostración.
        </p>
      </Reveal>
    </div>
  );
}

// ─── 01 El problema ───────────────────────────────────────────────────────────

function ElProblema() {
  return (
    <section id="problema" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <Reveal><div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-dim">01 — El problema</div></Reveal>
      <div className="mt-[22px] grid items-start gap-[clamp(24px,4vw,60px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))' }}>
        <Reveal dir="left">
          <h2 style={{ margin: 0, fontSize: 'clamp(30px,4.2vw,54px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, textWrap: 'balance' } as React.CSSProperties}>
            El día 11, con una calculadora mental.
          </h2>
          <p className="mt-[22px] text-[15px] leading-[1.65] text-ash" style={{ maxWidth: 520, textWrap: 'pretty' } as React.CSSProperties}>
            Mariana distribuye material eléctrico en Guadalupe, Nuevo León. Catorce empleados, nómina el 15 y el 30, $180,000 MXN por quincena. Vende a contratistas y ferreterías a net-30 con CFDI PPD; los clientes pagan cuando les conviene.
          </p>
          <p className="mt-4 text-[15px] leading-[1.65] text-ash" style={{ maxWidth: 520, textWrap: 'pretty' } as React.CSSProperties}>
            Su contador entrega estados financieros el día 5 del mes siguiente. Para decidir algo el día 11, eso llega seis semanas tarde. Lo que queda es la app del banco y una resta de cabeza — y cuando no cuadra, la tarjeta corporativa al 45% APR.
          </p>
          <div className="mt-[26px] flex flex-wrap gap-2">
            {['14 empleados', '$180,000 MXN / quincena', 'net-30 · CFDI PPD'].map(t => (
              <span key={t} className="flex items-center rounded-full border border-ash/16 px-4 text-[12.5px] text-ash" style={{ height: 34 }}>{t}</span>
            ))}
          </div>
        </Reveal>

        <Reveal dir="right" delay={120}>
          <div className="pnt-lift rounded-[26px] p-[clamp(22px,3vw,34px)]"
            style={{ background: '#060906', border: '1px solid rgba(199,214,213,0.10)' }}>
            <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-dim">Los cuatro días que deciden el mes</div>
            <div className="mt-5 flex flex-col">
              {[
                { day: 'DÍA 11', title: 'Puente detecta el breach', desc: 'Faltan $25,300 MXN para la nómina del 15.', dayColor: '#6D7275' },
                { day: 'DÍA 11', title: 'Recovery ladder, no crédito', desc: 'Cobrar A-4471 de Ferretería López 4 días antes cierra el hueco.', dayColor: '#6D7275' },
                { day: 'DÍA 13', title: 'López deposita', desc: 'Históricamente liquida en 4 días de la solicitud.', dayColor: '#6D7275' },
                { day: 'DÍA 15', title: 'Nómina pagada, cero deuda', desc: 'Sin tarjeta corporativa, sin comisión por sobregiro.', dayColor: '#C20114' },
              ].map((item, i, arr) => (
                <div key={i} className="flex gap-4 py-[14px]" style={{ borderBottom: i < arr.length - 1 ? '1px solid rgba(199,214,213,0.10)' : 'none' }}>
                  <span className="flex-none pt-[3px] font-mono text-[11px] tracking-[.12em]" style={{ color: item.dayColor }}>{item.day}</span>
                  <div>
                    <div className="text-[14.5px]">{item.title}</div>
                    <div className="mt-1 text-[13px] text-dim">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-[22px] flex items-center gap-[14px] pt-5" style={{ borderTop: '1px solid rgba(199,214,213,0.10)' }}>
              <div className="flex-none">
                <div className="num leading-none tracking-[-.035em]" style={{ fontSize: 'clamp(28px,3.2vw,40px)', fontWeight: 400 }}>
                  <CountNum value={370} prefix="$" />
                </div>
                <div className="mt-[6px] font-mono text-[10px] uppercase tracking-[.12em] text-dim">MXN de interés evitado</div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── 02 Cómo funciona ─────────────────────────────────────────────────────────

const STEPS = [
  { num: 'PASO 01', big: 'ZIP', title: 'Sube tus CFDI del portal SAT', body: 'El XML que ya tienes. Nada de credenciales, nada de permisos que revocar después.', dark: false },
  { num: 'PASO 02', big: '1:1', title: 'Reconciliación automática', body: 'Cada factura se amarra a su depósito. De ahí salen los learned payment terms: cuándo paga de verdad cada cliente, no lo que dice el contrato.', dark: false },
  { num: 'PASO 03', big: '30d', title: 'Tu digital twin', body: 'La curva de caja con banda P20, el día exacto del breach y la ruta para cerrarlo antes de que llegue.', dark: true },
];

function ComoFunciona() {
  return (
    <section id="como" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <Reveal><div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-dim">02 — Cómo funciona</div></Reveal>
      <Reveal delay={80}>
        <h2 style={{ margin: '22px 0 0', maxWidth: 780, fontSize: 'clamp(30px,4.2vw,54px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, textWrap: 'balance' } as React.CSSProperties}>
          Tres pasos, cinco minutos, cero integraciones.
        </h2>
      </Reveal>
      <div className="mt-[clamp(28px,4vw,48px)] grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,290px),1fr))' }}>
        {STEPS.map((s, i) => (
          <Reveal key={s.num} delay={i * 110}>
            <div className="pnt-lift h-full rounded-[26px] p-[clamp(22px,2.6vw,30px)]"
              style={{ background: s.dark ? '#060906' : 'rgba(109,114,117,0.13)', border: '1px solid rgba(199,214,213,0.10)' }}>
              <div className="font-mono text-[11px] tracking-[.12em] text-dim">{s.num}</div>
              <div className="mt-[26px] leading-none tracking-[-.035em]" style={{ fontSize: 'clamp(34px,4vw,52px)', fontWeight: 400, color: s.dark ? '#C20114' : '#ECEBF3' }}>{s.big}</div>
              <div className="mt-4 text-[15px] font-medium">{s.title}</div>
              <p className="mt-2 text-[13.5px] leading-[1.6] text-dim">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── 03 Producto ──────────────────────────────────────────────────────────────

const FEATURES = [
  { num: '01', badge: 'Predicción', badgeStyle: { background: '#C20114' }, title: 'Forecast a 30 días con la banda pesimista puesta', body: 'La línea esperada descuenta el riesgo de cada cliente. Debajo, el escenario P20: lo que pasa si los cobros se atrasan como se atrasan en la vida real. El punto mínimo viene con fecha y monto.', tags: ['Línea esperada', 'Banda P20', 'Punto mínimo'], imgRight: true, dark: false, screenshotLabel: '/prediccion', screenshotSub: 'gráfica de forecast + callout del mínimo' },
  { num: '02', badge: 'Breach alert', badgeStyle: { border: '1px solid rgba(199,214,213,0.18)', color: '#C7D6D5' }, title: 'El aviso llega el 11, no el 15', body: 'Una notificación con el día, el monto y la causa: «el 15 te faltan $25,300 para la nómina». Cuatro días de margen son la diferencia entre negociar un cobro y firmar una tarjeta al 45%.', tags: [], imgRight: false, dark: false, screenshotLabel: 'alerta de breach', screenshotSub: 'push del día 11 + desglose de la quincena' },
  { num: '03', badge: 'Recovery ladder', badgeStyle: { border: '1px solid rgba(199,214,213,0.18)', color: '#C7D6D5' }, title: 'Primero cobrar. El crédito es el último escalón', body: 'Puente ordena las acciones por costo real: adelantar el cobro que sí se puede adelantar, diferir un pago sin penalización y, sólo si nada alcanza, líneas pre-calificadas ordenadas por costo efectivo — no por comisión.', tags: [], imgRight: true, dark: false, screenshotLabel: '/recovery', screenshotSub: 'escalera de acciones con costo por escalón', ladder: true },
  { num: '04', badge: 'Structural refusal', badgeStyle: { border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: '#EF4444' }, title: 'A veces la respuesta correcta es «no te endeudes»', body: 'Si el hueco es estructural y no de calendario, Puente oculta las ofertas de crédito y muestra la simulación: en qué mes los intereses te llevan a la insolvencia. Cobramos suscripción precisamente para poder decirte esto.', tags: [], imgRight: false, dark: true, screenshotLabel: 'structural refusal', screenshotSub: 'simulación contrafactual de insolvencia' },
] as const;

function Producto() {
  return (
    <section id="producto" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <Reveal><div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-dim">03 — Producto</div></Reveal>
      <Reveal delay={80}>
        <h2 style={{ margin: '22px 0 0', maxWidth: 840, fontSize: 'clamp(30px,4.2vw,54px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, textWrap: 'balance' } as React.CSSProperties}>
          Cuatro pantallas. Una sola pregunta: ¿llego al 15?
        </h2>
      </Reveal>
      <div className="mt-[clamp(28px,4vw,52px)] flex flex-col gap-[clamp(28px,4vw,54px)]">
        {FEATURES.map(f => (
          <div key={f.num} className="grid items-center gap-[clamp(16px,2.4vw,30px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))' }}>
            <Reveal dir={f.imgRight ? 'left' : 'right'}>
              <div className={f.imgRight ? '' : 'lg:order-last'}>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] tracking-[.12em] text-dim">{f.num}</span>
                  <span className="inline-flex items-center rounded-full font-mono text-[10px] uppercase tracking-[.12em]"
                    style={{ height: 30, padding: '0 14px', ...f.badgeStyle }}>{f.badge}</span>
                </div>
                <h3 style={{ margin: '20px 0 0', fontSize: 'clamp(24px,2.9vw,36px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.08 }}>{f.title}</h3>
                <p className="mt-[14px] text-[14.5px] leading-[1.65] text-ash" style={{ maxWidth: 470, textWrap: 'pretty' } as React.CSSProperties}>{f.body}</p>
                {f.tags.length > 0 && (
                  <div className="mt-[22px] flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[.12em] text-dim">
                    {f.tags.map(t => <span key={t} className="flex items-center rounded-full border border-ash/16 px-[13px]" style={{ height: 30 }}>{t}</span>)}
                  </div>
                )}
                {'ladder' in f && f.ladder && (
                  <div className="mt-[22px] flex max-w-[470px] flex-col gap-2">
                    {[
                      { n: '01', label: 'Adelantar cobro', cost: 'costo $0', active: true },
                      { n: '02', label: 'Diferir pago a proveedor', cost: 'sin penalización', active: false },
                      { n: '03', label: 'Línea pre-calificada', cost: 'por costo efectivo', active: false },
                    ].map(row => (
                      <div key={row.n} className="flex items-center gap-3 rounded-full px-4"
                        style={{ height: 46, background: 'rgba(109,114,117,0.13)', border: '1px solid rgba(199,214,213,0.10)' }}>
                        <span className="font-mono text-[10px] tracking-[.12em]" style={{ color: row.active ? '#C20114' : '#6D7275' }}>{row.n}</span>
                        <span className="text-[13.5px]">{row.label}</span>
                        <span className="ml-auto font-mono text-[10px] uppercase tracking-[.12em] text-dim">{row.cost}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
            <Reveal dir={f.imgRight ? 'right' : 'left'} delay={100}>
              <div className="pnt-lift rounded-[26px]" style={{ border: '1px solid rgba(199,214,213,0.10)', background: `repeating-linear-gradient(115deg, rgba(199,214,213,0.16) 0 1.5px, rgba(199,214,213,0) 1.5px 10px), ${f.dark ? '#060906' : 'rgba(109,114,117,0.13)'}`, minHeight: 'clamp(230px,24vw,330px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' as const }}>
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[.12em] text-ash">captura — {f.screenshotLabel}</div>
                  <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[.12em] text-dim">{f.screenshotSub}</div>
                </div>
              </div>
            </Reveal>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── CTA intermedio ───────────────────────────────────────────────────────────

function CtaInter() {
  return (
    <Reveal>
      <div className="mt-[clamp(56px,8vw,110px)] flex flex-wrap items-center justify-between gap-[18px] rounded-[26px] p-[clamp(22px,3vw,32px)]"
        style={{ border: '1px solid rgba(199,214,213,0.10)', background: 'rgba(109,114,117,0.13)' }}>
        <div>
          <div className="leading-none tracking-[-.03em]" style={{ fontSize: 'clamp(20px,2.4vw,28px)' }}>¿Listo para ver tu propia curva?</div>
          <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[.12em] text-dim">Cinco minutos · sin tarjeta · datos tuyos</div>
        </div>
        <Link to="/login" className="flex items-center whitespace-nowrap rounded-full bg-ember text-[14px] font-medium text-ghost hover:bg-[#D9111F]"
          style={{ height: 48, padding: '0 24px' }}>Sube tu ZIP de CFDI</Link>
      </div>
    </Reveal>
  );
}

// ─── 04 Para quién ────────────────────────────────────────────────────────────

const SEGMENTS = [
  { icon: <span className="size-[26px] rounded-[8px] bg-ember" />, title: 'Distribución y ferretería', body: 'Net-30 con contratistas que pagan a 45. Inventario que se compra antes de cobrarse.', dark: false },
  { icon: <span className="size-[26px] rounded-[8px] border-2 border-ash" />, title: 'Manufactura ligera', body: 'Nómina quincenal rígida contra órdenes grandes y concentradas en pocos clientes.', dark: false },
  { icon: <span className="size-[26px] rounded-full border-2 border-ember" />, title: 'Servicios B2B', body: 'Facturación PPD mensual, cobranza dispersa y un solo mes malo que arrastra al siguiente.', dark: true },
];

function ParaQuien() {
  return (
    <section id="segmentos" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <Reveal><div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-dim">04 — Para quién</div></Reveal>
      <div className="mt-[22px] grid items-end gap-[clamp(24px,4vw,60px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))' }}>
        <Reveal dir="left">
          <h2 style={{ margin: 0, fontSize: 'clamp(30px,4.2vw,54px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, textWrap: 'balance' } as React.CSSProperties}>
            Si facturas a crédito y pagas nómina fija, este es tu problema.
          </h2>
        </Reveal>
        <Reveal dir="right">
          <p className="m-0 text-[14.5px] leading-[1.65] text-ash" style={{ maxWidth: 420, textWrap: 'pretty' } as React.CSSProperties}>
            El motor es el mismo; lo que cambia es de dónde viene el ingreso y qué tan rígido es el calendario de salidas.
          </p>
        </Reveal>
      </div>
      <div className="mt-[clamp(28px,4vw,44px)] grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,270px),1fr))' }}>
        {SEGMENTS.map((s, i) => (
          <Reveal key={s.title} delay={i * 110}>
            <div className="pnt-lift h-full rounded-[26px] p-[clamp(22px,2.6vw,30px)]"
              style={{ background: s.dark ? '#060906' : 'rgba(109,114,117,0.13)', border: '1px solid rgba(199,214,213,0.10)' }}>
              {s.icon}
              <div className="mt-5 text-[17px] font-medium">{s.title}</div>
              <p className="mt-[10px] text-[13.5px] leading-[1.6] text-dim">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── 05 Comparación ───────────────────────────────────────────────────────────

const COMPARE_ROWS = [
  { label: 'Mira hacia adelante', puente: 'Sí · 30 días', contador: 'No · cierra el mes', tarjeta: 'No' },
  { label: 'Frecuencia de actualización', puente: 'Diaria', contador: 'Mensual, día 5', tarjeta: 'No aplica' },
  { label: 'Te avisa antes del faltante', puente: '4 días antes', contador: 'No', tarjeta: 'No' },
  { label: 'Te dice cuándo NO endeudarte', puente: 'Sí', contador: 'A veces', tarjeta: 'Nunca' },
  { label: 'Costo de cerrar $25,000 a 10 días', puente: '$0', contador: '—', tarjeta: '≈ $370 + comisiones' },
];

function Comparacion() {
  return (
    <section id="comparacion" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <Reveal><div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-dim">05 — Comparación</div></Reveal>
      <Reveal delay={80}>
        <h2 style={{ margin: '22px 0 0', maxWidth: 800, fontSize: 'clamp(30px,4.2vw,54px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, textWrap: 'balance' } as React.CSSProperties}>
          Contra lo que hoy usas el día 11.
        </h2>
      </Reveal>
      <Reveal delay={140}>
        <div className="mt-[clamp(28px,4vw,44px)] overflow-x-auto rounded-[26px]"
          style={{ border: '1px solid rgba(199,214,213,0.10)', background: 'rgba(109,114,117,0.13)' }}>
          <div style={{ minWidth: 680 }}>
            <div className="grid items-center px-6 py-[18px] font-mono text-[10px] uppercase tracking-[.12em] text-dim"
              style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr', borderBottom: '1px solid rgba(199,214,213,0.10)' }}>
              <div /><div className="text-ghost">Puente</div><div>Contador externo</div><div>Tarjeta corporativa</div>
            </div>
            {COMPARE_ROWS.map((row, i) => (
              <div key={row.label} className="grid items-center px-6 py-[18px] text-[13.5px]"
                style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr', borderBottom: i < COMPARE_ROWS.length - 1 ? '1px solid rgba(199,214,213,0.10)' : 'none' }}>
                <div className="text-ash">{row.label}</div>
                <div className="num text-ember">{row.puente}</div>
                <div className="text-dim">{row.contador}</div>
                <div className="num text-dim">{row.tarjeta}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ─── 06 Mercado ───────────────────────────────────────────────────────────────

const MARKET = [
  { label: 'TAM', value: '4.8M', bar: 100, color: '#ECEBF3', body: 'Unidades económicas MSME en México. Fuente: INEGI · DENUE.', dark: false },
  { label: 'SAM', value: '1.1M', bar: 23, color: '#ECEBF3', body: 'PyMEs formales que emiten CFDI PPD recurrente con cuenta empresarial.', dark: false },
  { label: 'SOM · año 1', value: '18,000', bar: 6, color: '#C20114', body: 'Zona metropolitana de Monterrey. Canal primario: contadores externos que ya custodian el XML de 20–40 clientes.', dark: true },
];

function Mercado() {
  return (
    <section id="mercado" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <Reveal><div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-dim">06 — Mercado</div></Reveal>
      <div className="mt-[22px] grid items-end gap-[clamp(24px,4vw,60px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))' }}>
        <Reveal dir="left">
          <h2 style={{ margin: 0, fontSize: 'clamp(30px,4.2vw,54px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, textWrap: 'balance' } as React.CSSProperties}>
            1.1 millones de PyMEs facturan a crédito y proyectan a ciegas.
          </h2>
        </Reveal>
        <Reveal dir="right">
          <p className="m-0 text-[14.5px] leading-[1.65] text-ash" style={{ maxWidth: 420, textWrap: 'pretty' } as React.CSSProperties}>
            Empezamos por Monterrey: distribución y manufactura ligera, 10–50 empleados, nómina quincenal rígida contra cobros a 30–60 días. Ahí el hueco es estructural, no ocasional.
          </p>
        </Reveal>
      </div>
      <div className="mt-[clamp(28px,4vw,44px)] grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))' }}>
        {MARKET.map((m, i) => (
          <Reveal key={m.label} delay={i * 110}>
            <div className="pnt-lift h-full rounded-[26px] p-[clamp(22px,2.6vw,30px)]"
              style={{ background: m.dark ? '#060906' : 'rgba(109,114,117,0.13)', border: '1px solid rgba(199,214,213,0.10)' }}>
              <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-dim">{m.label}</div>
              <div className="num mt-[14px] leading-none tracking-[-.035em]" style={{ fontSize: 'clamp(34px,4.4vw,56px)', fontWeight: 400, color: m.color }}>{m.value}</div>
              <div className="mt-5"><BarReveal pct={m.bar} color="#C20114" height={6} /></div>
              <p className="mt-4 text-[13.5px] leading-[1.6] text-dim">{m.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── Quote ────────────────────────────────────────────────────────────────────

function Quote() {
  return (
    <Reveal dir="scale">
      <div className="mt-[clamp(56px,8vw,110px)] rounded-[34px] p-[clamp(28px,5vw,64px)]"
        style={{ border: '1px solid rgba(199,214,213,0.13)', background: 'radial-gradient(100% 120% at 15% 0%, rgba(109,114,117,0.26), rgba(12,18,12,0) 70%), #060906' }}>
        <div className="font-mono text-[10px] uppercase tracking-[.12em] text-dim">Persona de diseño · escenario de demostración</div>
        <blockquote className="m-0 mt-6 leading-[1.18] tracking-[-.03em]"
          style={{ fontSize: 'clamp(22px,3.2vw,40px)', fontWeight: 400, maxWidth: 900, textWrap: 'pretty' } as React.CSSProperties}>
          «Yo no necesitaba un crédito. Necesitaba saber, el día 11, que el 15 no me alcanzaba.»
        </blockquote>
        <div className="mt-[30px] flex flex-wrap items-center gap-[14px]">
          <div className="flex size-11 items-center justify-center rounded-full text-[13px] font-semibold"
            style={{ background: 'rgba(109,114,117,0.30)', border: '1px solid rgba(199,214,213,0.18)' }}>MS</div>
          <div>
            <div className="text-[14.5px]">Mariana Sada</div>
            <div className="mt-[3px] font-mono text-[10px] uppercase tracking-[.12em] text-dim">Directora general · distribución eléctrica · Guadalupe, NL</div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

// ─── 07 Precio ────────────────────────────────────────────────────────────────

const PLANS = [
  { name: 'Pulso', price: '$399', perMonth: 'MXN / mes', features: ['1 cuenta bancaria', 'Forecast a 30 días', 'Breach alerts básicas'], cta: 'Empezar', featured: false },
  { name: 'Operación', price: '$899', perMonth: 'MXN / mes', features: ['Reconciliación CFDI multi-cuenta', 'Recovery Path completo', 'Stress Lab de escenarios'], cta: 'Empezar con Operación', featured: true, badge: 'Recomendado' },
  { name: 'Tesorería', price: '$1,899', perMonth: 'MXN / mes', features: ['DSO conductual por cliente', 'Motores contrafactuales a medida', 'Acceso a Funding Bridge'], cta: 'Hablar con ventas', featured: false },
];

function Precio() {
  return (
    <section id="precio" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <Reveal><div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-dim">07 — Precio</div></Reveal>
      <div className="mt-[22px] grid items-end gap-[clamp(24px,4vw,60px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))' }}>
        <Reveal dir="left">
          <h2 style={{ margin: 0, fontSize: 'clamp(30px,4.2vw,54px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, textWrap: 'balance' } as React.CSSProperties}>
            Pagas el software, no la deuda.
          </h2>
        </Reveal>
        <Reveal dir="right">
          <p className="m-0 text-[14.5px] leading-[1.65] text-ash" style={{ maxWidth: 420, textWrap: 'pretty' } as React.CSSProperties}>
            Un sobregiro o diez días de tarjeta al 45% APR sobre $25,000 MXN cuestan cerca de $370 MXN. Evitar un evento de deuda al mes paga el plan Operación completo.
          </p>
        </Reveal>
      </div>
      <div className="mt-[clamp(28px,4vw,44px)] grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,270px),1fr))' }}>
        {PLANS.map((plan, i) => (
          <Reveal key={plan.name} delay={i * 110}>
            <div className="pnt-lift flex h-full flex-col gap-5 rounded-[26px] p-[clamp(24px,2.8vw,32px)]"
              style={{ background: plan.featured ? '#060906' : 'rgba(109,114,117,0.13)', border: plan.featured ? '1px solid rgba(194,1,20,0.45)' : '1px solid rgba(199,214,213,0.10)' }}>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-dim">{plan.name}</div>
                  {'badge' in plan && plan.badge && (
                    <span className="flex items-center rounded-full bg-ember font-mono text-[9.5px] uppercase tracking-[.12em] text-ghost" style={{ height: 26, padding: '0 12px' }}>{plan.badge}</span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="num leading-none tracking-[-.035em]" style={{ fontSize: 'clamp(34px,4vw,48px)', fontWeight: 400 }}>{plan.price}</span>
                  <span className="text-[13px] text-dim">{plan.perMonth}</span>
                </div>
              </div>
              <div className="flex flex-col gap-[10px] text-[13.5px] text-ash">
                {plan.features.map(feat => (
                  <div key={feat} className="flex gap-[10px]">
                    <span style={{ color: plan.featured ? '#C20114' : '#6D7275' }}>—</span>{feat}
                  </div>
                ))}
              </div>
              <Link to="/login" className="mt-auto flex items-center justify-center rounded-full text-[13.5px] font-medium text-ghost hover:opacity-90"
                style={plan.featured ? { height: 46, background: '#C20114' } : { height: 46, border: '1px solid rgba(199,214,213,0.20)' }}>
                {plan.cta}
              </Link>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal>
        <p className="mt-[22px] text-[12px] text-dim">
          Si tu negocio entra en déficit estructural, el crédito se oculta y la suscripción sigue siendo el único ingreso que cobramos.
        </p>
      </Reveal>
    </section>
  );
}

// ─── 08 FAQ ───────────────────────────────────────────────────────────────────

const FAQS = [
  { q: '¿Necesito dar mis credenciales del banco?', a: 'No. No pedimos contraseñas ni API keys. Eliges tu cuenta operativa por número de cuenta y subes el XML que el SAT ya te entrega. Sin OAuth de adorno ni permisos permanentes.' },
  { q: '¿En qué se diferencia de mi contador?', a: 'Tu contador mira hacia atrás y cierra el mes. Puente mira 30 días hacia adelante y se actualiza todos los días. Son complementarios: de hecho, el canal por el que llegamos a la mayoría de nuestros clientes son contadores externos.' },
  { q: '¿Qué tan confiable es la predicción?', a: 'No prometemos un número único. Cada cliente tiene sus learned payment terms aprendidos de tu propio historial de cobros, y siempre verás la banda P20 junto a la línea esperada. Si el escenario pesimista rompe la nómina, eso es lo que te decimos.' },
  { q: '¿Ganan comisión si acepto un crédito?', a: 'Sí, entre 1% y 3% del monto fondeado, y sólo si el crédito se desembolsa. Por eso cobramos suscripción: el ingreso recurrente es mayor que la comisión, así que el incentivo está en que te quedes, no en que te endeudes.' },
  { q: '¿Funciona si vendo mucho de contado?', a: 'Sí. Los depósitos sin factura asociada se tratan como venta de contado y entran al modelo con su propio patrón. Es la norma en retail y no rompe la proyección.' },
];

function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section id="faq" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <div className="grid items-start gap-[clamp(24px,4vw,60px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))' }}>
        <Reveal dir="left">
          <div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-dim">08 — FAQ</div>
          <h2 style={{ margin: '22px 0 0', fontSize: 'clamp(30px,4.2vw,54px)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, textWrap: 'balance' } as React.CSSProperties}>
            Preguntas que siempre nos hacen.
          </h2>
          <p className="mt-[18px] text-[14.5px] leading-[1.65] text-ash" style={{ maxWidth: 380 }}>
            ¿Falta la tuya? <Link to="/login" className="text-ember hover:text-ghost">Escríbenos</Link>.
          </p>
        </Reveal>
        <Reveal dir="right">
          <div className="flex flex-col">
            {FAQS.map((faq, i) => (
              <div key={i} className="cursor-pointer py-[22px]"
                style={{ borderTop: '1px solid rgba(199,214,213,0.10)', borderBottom: i === FAQS.length - 1 ? '1px solid rgba(199,214,213,0.10)' : 'none' }}
                onClick={() => setOpen(open === i ? null : i)}>
                <div className="flex items-start justify-between gap-5">
                  <span className="text-[16px] leading-[1.4]">{faq.q}</span>
                  <span className="flex-none text-[20px] leading-none"
                    style={{ color: open === i ? '#C20114' : '#6D7275', transform: open === i ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease, color 0.2s ease' }}>
                    {open === i ? '−' : '+'}
                  </span>
                </div>
                <div style={{ maxHeight: open === i ? 300 : 0, overflow: 'hidden', transition: 'max-height 0.35s ease' }}>
                  <p className="mt-[14px] text-[14px] leading-[1.65] text-ash" style={{ maxWidth: 600 }}>{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── CTA final ────────────────────────────────────────────────────────────────

function CtaFinal() {
  return (
    <section id="cta" style={{ padding: 'clamp(64px,9vw,132px) 0 0' }}>
      <Reveal dir="scale">
        <div className="relative overflow-hidden rounded-[34px] text-center"
          style={{ border: '1px solid rgba(199,214,213,0.13)', background: 'radial-gradient(110% 120% at 80% 0%, rgba(109,114,117,0.28) 0%, rgba(109,114,117,0.10) 45%, rgba(12,18,12,0) 75%), #060906', padding: 'clamp(34px,6vw,90px) clamp(24px,5vw,64px)' }}>
          <h2 className="mx-auto m-0 leading-[1.02] tracking-[-.035em]"
            style={{ maxWidth: 780, fontSize: 'clamp(32px,5.2vw,66px)', fontWeight: 400, textWrap: 'balance' } as React.CSSProperties}>
            Deja de restar de cabeza el día 11.
          </h2>
          <p className="mx-auto mt-[22px] text-[15px] leading-[1.65] text-ash" style={{ maxWidth: 520, textWrap: 'pretty' } as React.CSSProperties}>
            Sube tu ZIP de CFDI, elige tu cuenta y mira tu curva de 30 días. Cinco minutos, sin tarjeta.
          </p>
          <div className="mt-[34px] flex flex-wrap items-center justify-center gap-[10px]">
            <Link to="/login" className="flex items-center gap-3 rounded-full bg-ember font-medium text-ghost hover:bg-[#D9111F]"
              style={{ height: 56, paddingLeft: 28, paddingRight: 12, fontSize: 15.5 }}>
              Sube tu ZIP de CFDI
              <span className="flex size-[34px] items-center justify-center rounded-full" style={{ background: 'rgba(12,18,12,0.28)' }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#ECEBF3" strokeWidth="1.5"><path d="M3 8h9.5"/><path d="M8.8 4.3L13 8l-4.2 3.7"/></svg>
              </span>
            </Link>
            <a href="#precio" className="flex items-center rounded-full border border-ash/20 text-ghost hover:border-ash/45"
              style={{ height: 56, padding: '0 28px', fontSize: 15.5 }}>
              Ver planes
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  const cols = [
    { heading: 'Producto', links: [['Predicción', '#producto'], ['Recovery Path', '#producto'], ['Stress Lab', '#producto'], ['Funding Bridge', '#producto']] },
    { heading: 'Compañía', links: [['Mercado', '#mercado'], ['Comparación', '#comparacion'], ['Precio', '#precio'], ['Contacto', '#cta']] },
    { heading: 'Para contadores', links: [['Programa de socios', '#cta'], ['20% revenue share', '#cta'], ['Portafolio de clientes', '#cta']] },
    { heading: 'Legal', links: [['Privacidad', '#cta'], ['Términos', '#cta'], ['Seguridad', '#cta']] },
  ];
  return (
    <footer style={{ padding: 'clamp(48px,7vw,92px) 0 40px' }}>
      <div className="grid gap-[clamp(24px,3vw,40px)] pb-9" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', borderBottom: '1px solid rgba(199,214,213,0.10)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-[10px]">
            <span className="size-[18px] rounded-[6px] bg-ember" />
            <span className="text-[18px] font-medium tracking-[-.01em]">Puente</span>
          </div>
          <p className="mt-4 text-[13.5px] leading-[1.6] text-dim" style={{ maxWidth: 260 }}>
            Inteligencia de capital de trabajo para PyMEs mexicanas. Monterrey, Nuevo León.
          </p>
        </div>
        {cols.map(col => (
          <div key={col.heading}>
            <div className="font-mono text-[10px] uppercase tracking-[.12em] text-dim">{col.heading}</div>
            <div className="mt-4 flex flex-col gap-[10px] text-[13.5px]">
              {col.links.map(([label, href]) => <a key={label} href={href} className="text-ash hover:text-ghost">{label}</a>)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-[14px] pt-6 font-mono text-[10px] uppercase tracking-[.12em] text-dim">
        <span>© 2026 Puente · Monterrey, MX</span>
        <span>Montos en MXN · CFDI 4.0 · Datos de demostración</span>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Landing() {
  const progress = useScrollProgress();
  return (
    <div className="min-h-screen" style={{ background: '#0C120C', color: '#ECEBF3', overflowX: 'hidden' }}>
      <LandingAnimations />
      {/* scroll progress bar */}
      <div className="fixed left-0 right-0 top-0 z-[60]" style={{ height: 2, background: 'rgba(199,214,213,0.10)' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: '#C20114', transition: 'width 0.1s linear' }} />
      </div>
      <div className="mx-auto w-full max-w-[1340px] box-border px-[clamp(18px,4vw,52px)]">
        <Nav />
        <Hero />
        <Ticker />
        <StatBand />
        <ElProblema />
        <ComoFunciona />
        <Producto />
        <CtaInter />
        <ParaQuien />
        <Comparacion />
        <Mercado />
        <Quote />
        <Precio />
        <Faq />
        <CtaFinal />
        <Footer />
      </div>
    </div>
  );
}
