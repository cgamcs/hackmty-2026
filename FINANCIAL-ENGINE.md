# Motor financiero

El paquete `financial_engine` implementa el núcleo explicable del producto sin depender de
FastAPI, Supabase, Nessie o el parser CFDI. Esas capas solo deben convertir sus respuestas al
contrato de entrada.

## Contrato de entrada

- `BusinessSnapshot.current_balance`: saldo real de Nessie.
- `historical_flows`: depósitos positivos y compras/retiros negativos ya liquidados.
- `obligations`: pagos exactos futuros; nómina e impuestos deben marcar
  `hard_deadline=True`.
- `receivables`: CFDI PPD todavía no conciliados con un depósito.
- `available_cash_buffer`: reserva separada que puede transferirse a la cuenta operativa.
- `safety_buffer`: saldo mínimo recomendado por la empresa.

Todas las fechas son `datetime.date` y todos los montos usan la misma moneda. Para producción
se recomienda convertir los montos a centavos enteros en la capa de persistencia.

## Uso

```python
from financial_engine import FinancialEngine

result = FinancialEngine(horizon_days=30).analyze(snapshot)
payload = result.to_dict()  # listo para responder JSON desde FastAPI
```

Si el backend ya tiene un diccionario proveniente de JSON:

```python
from financial_engine import snapshot_from_dict

snapshot = snapshot_from_dict(request_json)
```

La salida contiene:

- curvas diaria esperada y pesimista;
- primera obligación que no se puede cubrir y su faltante;
- clasificación `none`, `timing` o `structural`;
- `health_score` y `resilience_score` de 0 a 100;
- escalera de acciones ordenada: cobrar antes, mover un pago flexible, usar reserva y crédito;
- decisión explícita de financiamiento (`should_suggest`, razón, monto y plazo);
- diagnósticos explicables para la UI.

## Stress Lab

```python
from financial_engine import StressScenario

stress = StressScenario(
    name="ventas -25% y cliente +5 días",
    inflow_change_pct=-0.25,
    receivable_delay_days=5,
    unexpected_expense=12_000,
)
result = FinancialEngine().simulate(snapshot, stress)
```

Para comparar varios escenarios del Stress Lab en una llamada:

```python
results = FinancialEngine().stress_lab(snapshot, [sales_down, delayed_customer, high_costs])
```

## Decisión de financiamiento

`result.financing_decision.status` puede ser:

- `not_needed`: no existe faltante;
- `covered_by_recovery_plan`: cobrar, reprogramar o usar reserva resuelve el faltante;
- `recommended`: persiste un déficit temporal y devuelve monto/plazo sugeridos;
- `not_recommended_structural`: la deuda empeoraría un déficit sostenido.

## Probar y ejecutar

No requiere paquetes externos:

```bash
python3 -m unittest discover -s tests -v
PYTHONPATH=. python3 examples/analyze_mocks.py bajio
```

## Integración recomendada

El backend debe construir un `BusinessSnapshot` después de normalizar y conciliar datos:

```text
Nessie balance --------------------------> current_balance
Nessie deposits/purchases/withdrawals ---> historical_flows
Nessie bills + CFDI recibidos pendientes -> obligations
CFDI emitidos PPD no conciliados --------> receivables
```

No deben enviarse `company_id`, saldo ni permisos confiando en el navegador. El backend
obtiene la empresa desde la sesión autenticada y arma el snapshot con datos de ese tenant.

### Mocks incluidos

`snapshot_from_mock_files(slug, project_root)` integra únicamente los datos de la PyME
seleccionada: sus XML de `mocks/out/cfdi`, su cuenta de Nessie y sus obligaciones. Los datos
de otras empresas nunca entran al `BusinessSnapshot` analizado. Los slugs disponibles son
`esperanza`, `bajio` y `roble`. Esta ruta es completamente local y no requiere la API key.

Para respuestas reales de Nessie, `snapshot_from_sources(...)` acepta directamente las
respuestas de cuenta, depósitos, compras, retiros y bills, además del directorio CFDI. El
adaptador concilia como pagados los folios que aparecen en la descripción de depósitos.
