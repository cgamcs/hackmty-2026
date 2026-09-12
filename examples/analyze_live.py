from __future__ import annotations

import argparse
import json
from pathlib import Path

from engine.nessie import Nessie
from financial_engine import FinancialEngine, find_company_account, snapshot_from_live_nessie


ROOT = Path(__file__).resolve().parents[1]


def money(value: float) -> str:
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.2f}"


def render_report(slug: str, rfc: str, account_id: str, result) -> str:
    """Render the complete result for a business owner, without external libraries."""

    breach = result.breach
    lines = [
        "=" * 88,
        "ANÁLISIS FINANCIERO A 30 DÍAS",
        "=" * 88,
        f"PyME:              {slug}",
        f"RFC:               {rfc}",
        f"Cuenta Nessie:     {account_id}",
        f"Fecha del análisis:{result.diagnostics['as_of']:>15}",
        "",
        "RESULTADO GENERAL",
        "-" * 88,
        f"Clasificación:     {result.gap_type.value}",
        f"Health Score:      {result.health_score}/100",
        f"Resilience Score:  {result.resilience_score}/100",
        f"Saldo final esperado:     {money(result.diagnostics['expected_ending_balance'])}",
        f"Saldo final pesimista:    {money(result.diagnostics['pessimistic_ending_balance'])}",
        f"Peor saldo proyectado:    {money(result.diagnostics['minimum_pessimistic_balance'])}",
        "",
        "PRIMER RIESGO DE LIQUIDEZ",
        "-" * 88,
    ]
    if breach:
        lines.extend(
            [
                f"Fecha:             {breach.date.isoformat()}",
                f"Obligación:        {breach.obligation}",
                f"Monto obligación:  {money(breach.amount)}",
                f"Faltante:          {money(breach.shortfall)}",
            ]
        )
    else:
        lines.append("No se detectaron obligaciones sin cobertura.")

    lines.extend(["", "RECOVERY PLAN", "-" * 88])
    if not result.recommendations:
        lines.append("No se requieren acciones correctivas.")
    for item in result.recommendations:
        status = "resuelve el horizonte" if item.resolves_breach else "acción parcial"
        lines.extend(
            [
                f"{item.rank}. {item.title}",
                f"   {item.description}",
                f"   Impacto de caja: {money(item.cash_impact)}",
                f"   Costo estimado:  {money(item.estimated_cost)}",
                f"   Resultado:       {status}",
            ]
        )

    financing = result.financing_decision
    lines.extend(
        [
            "",
            "DECISIÓN DE FINANCIAMIENTO",
            "-" * 88,
            f"Estado:             {financing.status.value}",
            f"¿Sugerir crédito?:  {'Sí' if financing.should_suggest else 'No'}",
            f"Razón:              {financing.reason}",
            f"Faltante residual:  {money(financing.residual_shortfall)}",
            f"Monto sugerido:     {money(financing.suggested_amount)}",
            f"Plazo de cobertura: {financing.term_days} días",
            "",
            "FORECAST DIARIO",
            "-" * 132,
            (
                f"{'Fecha':<12} {'Ingreso esp.':>16} {'Ingreso pes.':>16} "
                f"{'Gasto variable':>17} {'Obligaciones':>16} "
                f"{'Saldo esp.':>16} {'Saldo pes.':>16}"
            ),
            "-" * 132,
        ]
    )
    for point in result.points:
        lines.append(
            f"{point.date.isoformat():<12} "
            f"{money(point.expected_inflow):>16} "
            f"{money(point.pessimistic_inflow):>16} "
            f"{money(point.variable_outflow):>17} "
            f"{money(point.obligation_outflow):>16} "
            f"{money(point.expected_balance):>16} "
            f"{money(point.pessimistic_balance):>16}"
        )
    lines.extend(
        [
            "-" * 132,
            "Nota: 'acción parcial' significa que ayuda con el primer faltante, pero todavía",
            "queda al menos otra obligación sin cobertura dentro de los 30 días.",
        ]
    )
    return "\n".join(lines)


def company_config(slug: str) -> tuple[str, str, Path, str]:
    """Resolve IDs only; financial values are always fetched from Nessie."""

    manifest = json.loads((ROOT / "mocks/out/seed-manifest.json").read_text())
    entry = manifest[slug]
    cfdi_dirs = {
        "esperanza": "ALE240517H23",
        "bajio": "CBA190803M71",
        "roble": "MER210126F09",
    }
    names = {
        "esperanza": "Abarrotes La Esperanza",
        "bajio": "Comercializadora del Bajio",
        "roble": "Minisuper El Roble",
    }
    rfc = cfdi_dirs[slug]
    return entry["account_id"], rfc, ROOT / "mocks/out/cfdi" / rfc, names[slug]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analiza una sola PyME usando movimientos actuales de Nessie."
    )
    parser.add_argument("slug", choices=("esperanza", "bajio", "roble"))
    parser.add_argument(
        "--summary",
        action="store_true",
        help="muestra solo scores, clasificación y primer breach",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="imprime el contrato JSON completo para frontend/backend",
    )
    args = parser.parse_args()

    manifest_account_id, rfc, cfdi_directory, company_name = company_config(args.slug)
    client = Nessie()
    account = client.account(manifest_account_id)
    if account is None:
        account = find_company_account(client, company_name)
    if account is None:
        raise RuntimeError(
            f"La llave actual no contiene una cuenta para {company_name}. "
            "Ejecuta el seeder con esta misma API_KEY o usa la llave con la que "
            "se creó el manifiesto."
        )
    account_id = account["_id"]
    snapshot = snapshot_from_live_nessie(
        account_id=account_id,
        owner_rfc=rfc,
        cfdi_directory=cfdi_directory,
        client=client,
    )
    result = FinancialEngine(horizon_days=30).forecast(snapshot)
    if args.json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        return
    breach = result.breach
    breach_text = (
        f"{breach.date} · {breach.obligation} · ${breach.shortfall:,.0f}"
        if breach
        else "sin breach"
    )
    if args.summary:
        print(f"PyME: {args.slug} · RFC: {rfc} · cuenta: {account_id}")
        print(
            f"verdict={result.gap_type.value} health={result.health_score} "
            f"resilience={result.resilience_score} "
            f"financing={result.financing_decision.status.value}"
        )
        print(f"breach={breach_text}")
        return
    print(render_report(args.slug, rfc, account_id, result))


if __name__ == "__main__":
    main()
