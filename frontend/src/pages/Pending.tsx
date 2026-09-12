import { Link } from 'react-router-dom';

const COPY: Record<string, { title: string; body: string; eyebrow: string }> = {
  stress: {
    eyebrow: 'Stress Lab · simulación',
    title: 'Pon a prueba tu flujo',
    body: 'Mueve ingresos, gastos y retrasos de clientes para ver cuánto aguanta tu negocio antes de no cubrir una obligación.',
  },
  recovery: {
    eyebrow: 'Recovery Path · escalera',
    title: 'Cierra la brecha sin deuda',
    body: 'Adelanta cobranza, difiere pagos con holgura y usa tu buffer. La nómina y el SAT nunca se mueven.',
  },
  funding: {
    eyebrow: 'Funding Bridge · último peldaño',
    title: 'Crédito solo si hace falta',
    body: 'Si la escalera no cierra el faltante, comparamos ofertas por tasa implícita y armamos tu perfil para bancos.',
  },
  cfdi: {
    eyebrow: 'Integración · CFDI y banco',
    title: 'Sube tus CFDI y conecta tu cuenta',
    body: 'Arrastra tus XML o el ZIP de descarga masiva del SAT. Tu llave bancaria nunca llega al navegador.',
  },
  settings: {
    eyebrow: 'Ajustes',
    title: 'Preferencias de tu cuenta',
    body: 'Configuración de la cuenta y de la visualización.',
  },
};

/** Placeholder for views not yet designed in the handoff (1a–1d only). */
export default function Pending({ view }: { view: keyof typeof COPY }) {
  const c = COPY[view];
  return (
    <section className="card flex min-h-[420px] flex-col items-start justify-center gap-5 p-10">
      <div className="eyebrow">{c.eyebrow}</div>
      <h1 className="m-0 text-[40px] font-normal tracking-[-.035em]">{c.title}</h1>
      <p className="m-0 max-w-[560px] text-[15px] leading-relaxed text-ash">{c.body}</p>
      <div className="flex items-center gap-3">
        <span className="tag tag-muted">Pantalla en diseño</span>
        <Link to="/forecast" className="flex h-11 items-center rounded-full bg-ember px-[22px] text-[13.5px] font-medium hover:bg-ember/85">
          Ver predicción
        </Link>
      </div>
    </section>
  );
}
