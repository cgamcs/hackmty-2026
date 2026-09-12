"""Mock SMB scenarios.

One definition per business drives BOTH outputs — CFDI XML and Nessie records — so
Phase 2 reconciliation has something to match. Amounts are MXN.

Each scenario is tuned to produce a specific Phase 6 verdict. `expected_verdict` is
asserted by generate.py after seeding; if the numbers drift, the assertion fails loudly
rather than silently producing three identical-looking businesses.
"""

from dataclasses import dataclass, field

HISTORY_DAYS = 120  # 4 quincena cycles — enough signal for dow + period detection


@dataclass
class Supplier:
    name: str
    category: str
    restock_every_days: int


@dataclass
class Bill:
    payee: str
    amount: int
    recurring_date: int  # day of month
    kind: str            # payroll | rent | utility  -> drives hard-date classification


@dataclass
class Receivable:
    """A PPD invoice issued to a business client. `settled_after_days=None` means still
    open — these are what ladder rung 1 acts on."""
    client_name: str
    client_rfc: str
    amount: int
    issued_day_offset: int          # days before today
    settled_after_days: int | None  # None = still open


@dataclass
class Scenario:
    slug: str
    name: str
    rfc: str
    city: str
    state: str
    zip: str
    street_number: str
    street_name: str
    starting_balance: int
    daily_base_sales: int
    dow_factors: list[float]        # Mon..Sun
    quincena_factor: float
    trend_per_day: float            # 1.0 flat, <1 declining
    restock_ratio: float            # share of sales spent restocking
    cash_sale_share: float          # share of sales collected immediately, no CFDI
    collection_lag_days: int        # days credit sales take to settle (net-30 etc.)
    suppliers: list[Supplier]
    bills: list[Bill]
    receivables: list[Receivable] = field(default_factory=list)
    expected_verdict: str = "none"  # none | timing | structural


QUINCENA_DAYS = {14, 15, 16, 29, 30, 1}


SCENARIOS = [
    # ── Healthy retail: inflow comfortably covers obligations ──────────────────
    Scenario(
        slug="esperanza",
        name="Abarrotes La Esperanza",
        rfc="ALE240517H23",
        city="Leon", state="GT", zip="37000",
        street_number="142", street_name="Av Juarez",
        starting_balance=180_000,  # immutable after creation
        daily_base_sales=8_000,
        dow_factors=[0.90, 0.85, 0.90, 0.95, 1.15, 1.40, 1.10],
        quincena_factor=1.50,
        trend_per_day=1.0,
        restock_ratio=0.62,
        cash_sale_share=0.92,
        collection_lag_days=30,
        suppliers=[
            Supplier("Distribuidora Bimbo del Bajio", "abarrotes", 3),
            Supplier("Refrescos del Centro SA", "bebidas", 4),
            Supplier("Lacteos Santa Rosa", "lacteos", 3),
            Supplier("Abastos Mayoreo Leon", "abarrotes", 7),
        ],
        bills=[
            Bill("Renta Local Comercial", 18_000, 1, "rent"),
            Bill("Nomina Quincenal", 22_000, 15, "payroll"),
            Bill("Nomina Quincenal", 22_000, 30, "payroll"),
            Bill("CFE Energia", 3_500, 10, "utility"),
            Bill("Internet Totalplay", 800, 5, "utility"),
        ],
        receivables=[
            Receivable("Cocina Economica Doña Mari", "CEM180322K51", 12_400, 40, 28),
            Receivable("Cocina Economica Doña Mari", "CEM180322K51", 13_100, 10, None),
        ],
        expected_verdict="none",
    ),

    # ── Timing gap: net positive, but payroll lands before receivables settle ──
    Scenario(
        slug="bajio",
        name="Comercializadora del Bajio",
        rfc="CBA190803M71",
        city="Irapuato", state="GT", zip="36500",
        street_number="87", street_name="Blvd Diaz Ordaz",
        starting_balance=38_000,   # immutable after creation
        daily_base_sales=3_000,          # low cash sales — this one sells on credit
        dow_factors=[1.10, 1.05, 1.00, 1.05, 1.15, 0.70, 0.30],
        quincena_factor=1.15,
        trend_per_day=1.0,
        restock_ratio=0.55,
        cash_sale_share=0.35,
        collection_lag_days=30,
        suppliers=[
            Supplier("Abastos Mayoreo Leon", "abarrotes", 5),
            Supplier("Empaques del Centro", "insumos", 10),
            Supplier("Transportes Rapidos GTO", "logistica", 7),
        ],
        bills=[
            Bill("Renta Nave Industrial", 28_000, 1, "rent"),
            Bill("Nomina Operativa Quincenal", 78_000, 15, "payroll"),
            Bill("Nomina Operativa Quincenal", 78_000, 30, "payroll"),
            Bill("CFE Energia", 6_000, 10, "utility"),
        ],
        receivables=[
            # Issued on net-30 terms; the open ones land days 18-27 of the horizon.
            Receivable("Tiendas Del Valle SA", "TDV150612J88", 58_000, 45, 30),
            Receivable("Super Mercados Norte", "SMN160228R44", 52_000, 38, 29),
            Receivable("Tiendas Del Valle SA", "TDV150612J88", 61_000, 12, None),
            Receivable("Super Mercados Norte", "SMN160228R44", 47_500, 9, None),
            Receivable("Autoservicio La Central", "ALC170914B29", 55_000, 6, None),
            Receivable("Tiendas Del Valle SA", "TDV150612J88", 49_000, 3, None),
        ],
        expected_verdict="timing",
    ),

    # ── Structural deficit: declining sales, obligations outrun inflow ─────────
    Scenario(
        slug="roble",
        name="Minisuper El Roble",
        rfc="MER210126F09",
        city="Silao", state="GT", zip="36100",
        street_number="23", street_name="Calle Hidalgo",
        starting_balance=26_000,   # immutable after creation
        daily_base_sales=6_500,
        dow_factors=[0.95, 0.90, 0.90, 0.95, 1.10, 1.30, 1.00],
        quincena_factor=1.35,
        trend_per_day=0.997,             # ~30% decline across the history window
        restock_ratio=0.68,
        cash_sale_share=0.95,
        collection_lag_days=30,
        suppliers=[
            Supplier("Distribuidora Bimbo del Bajio", "abarrotes", 4),
            Supplier("Refrescos del Centro SA", "bebidas", 5),
        ],
        bills=[
            Bill("Renta Local Comercial", 28_000, 1, "rent"),
            Bill("Nomina Quincenal", 24_000, 15, "payroll"),
            Bill("Nomina Quincenal", 24_000, 30, "payroll"),
            Bill("CFE Energia", 4_200, 10, "utility"),
        ],
        receivables=[
            Receivable("Fonda El Buen Sazon", "FBS200715D62", 8_900, 20, None),
        ],
        expected_verdict="structural",
    ),
]
