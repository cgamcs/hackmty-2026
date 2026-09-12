"""CFDI 4.0 parser.

Reads a directory of CFDI XML and returns typed invoice records. Deliberately does NOT
validate the digital seal: mock CFDI carry a fabricated `Sello`, and a real SAT-valid
one needs a CSD certificate, so seal validation would make the pipeline untestable.

Two derivations the XML cannot give us directly:

1. Our own RFC. Direction (issued vs received) depends on knowing it, but we only know
   it by looking at the documents. Resolved in two passes: count RFC occurrences across
   both Emisor and Receptor, and the one present in every document is ours.

2. Due dates. `MetodoPago="PPD"` says payment is deferred but never says when — terms
   are commercial, not fiscal, so the SAT does not collect them. We apply
   config.NET_TERMS_DAYS, overridable per client RFC.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from config import NET_TERMS_DAYS

NS = {
    "cfdi": "http://www.sat.gob.mx/cfd/4",
    "tfd": "http://www.sat.gob.mx/TimbreFiscalDigital",
    "nomina12": "http://www.sat.gob.mx/nomina12",
}

# TipoDeComprobante
INGRESO, EGRESO, TRASLADO, NOMINA, PAGO = "I", "E", "T", "N", "P"


@dataclass
class Invoice:
    uuid: str
    serie: str
    folio: str
    tipo: str                 # I | E | T | N | P
    fecha: date
    total: float
    subtotal: float
    metodo_pago: str | None   # PUE | PPD | None (nomina)
    forma_pago: str | None
    emisor_rfc: str
    emisor_nombre: str
    receptor_rfc: str
    receptor_nombre: str
    source_file: str
    # Filled once our own RFC is known.
    direction: str = "unknown"      # issued | received
    due_date: date | None = None

    @property
    def reference(self) -> str:
        """Short human reference — what would appear in a bank transfer concepto."""
        return f"{self.serie}{self.folio}" if self.serie else self.folio

    @property
    def counterparty_rfc(self) -> str:
        return self.receptor_rfc if self.direction == "issued" else self.emisor_rfc

    @property
    def counterparty_name(self) -> str:
        return self.receptor_nombre if self.direction == "issued" else self.emisor_nombre

    @property
    def is_receivable(self) -> bool:
        """Money owed TO us: an invoice we issued on deferred payment terms."""
        return (self.direction == "issued"
                and self.tipo == INGRESO
                and self.metodo_pago == "PPD")

    @property
    def is_payable(self) -> bool:
        """Money we owe: a supplier invoice addressed to us."""
        return self.direction == "received" and self.tipo == INGRESO

    @property
    def is_payroll(self) -> bool:
        """Payroll receipt. Legally dated — the ladder must never propose shifting it."""
        return self.tipo == NOMINA


@dataclass
class Batch:
    own_rfc: str
    own_name: str
    invoices: list[Invoice] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)

    @property
    def receivables(self) -> list[Invoice]:
        return [i for i in self.invoices if i.is_receivable]

    @property
    def payables(self) -> list[Invoice]:
        return [i for i in self.invoices if i.is_payable]

    @property
    def payroll(self) -> list[Invoice]:
        return [i for i in self.invoices if i.is_payroll]


def _parse_fecha(raw: str) -> date:
    return datetime.fromisoformat(raw).date()


def parse_file(path: Path) -> Invoice:
    root = ET.parse(path).getroot()
    emisor = root.find("cfdi:Emisor", NS)
    receptor = root.find("cfdi:Receptor", NS)
    if emisor is None or receptor is None:
        raise ValueError("missing Emisor or Receptor")

    timbre = root.find(".//tfd:TimbreFiscalDigital", NS)
    return Invoice(
        uuid=(timbre.get("UUID") if timbre is not None else "") or "",
        serie=root.get("Serie") or "",
        folio=root.get("Folio") or "",
        tipo=root.get("TipoDeComprobante") or "",
        fecha=_parse_fecha(root.get("Fecha") or ""),
        total=float(root.get("Total") or 0),
        subtotal=float(root.get("SubTotal") or 0),
        metodo_pago=root.get("MetodoPago"),
        forma_pago=root.get("FormaPago"),
        emisor_rfc=emisor.get("Rfc") or "",
        emisor_nombre=emisor.get("Nombre") or "",
        receptor_rfc=receptor.get("Rfc") or "",
        receptor_nombre=receptor.get("Nombre") or "",
        source_file=path.name,
    )


def infer_own_rfc(invoices: list[Invoice]) -> tuple[str, str]:
    """Our RFC is the one appearing in every document, on either side.

    Counting only Emisor would break on a batch dominated by supplier invoices, where
    the most frequent issuer is a supplier rather than us.
    """
    counts: Counter[str] = Counter()
    for inv in invoices:
        counts.update({inv.emisor_rfc, inv.receptor_rfc})
    if not counts:
        return "", ""
    rfc, _ = counts.most_common(1)[0]
    name = next((i.emisor_nombre for i in invoices if i.emisor_rfc == rfc),
                next((i.receptor_nombre for i in invoices if i.receptor_rfc == rfc), ""))
    return rfc, name


def parse_dir(
    directory: str | Path,
    net_terms_days: int = NET_TERMS_DAYS,
    terms_by_rfc: dict[str, int] | None = None,
) -> Batch:
    """Parse every .xml under `directory`, then resolve direction and due dates."""
    directory = Path(directory)
    invoices, skipped = [], []
    for path in sorted(directory.rglob("*.xml")):
        try:
            invoices.append(parse_file(path))
        except Exception as e:                       # a bad file must not kill the batch
            skipped.append((path.name, str(e)))

    own_rfc, own_name = infer_own_rfc(invoices)
    terms_by_rfc = terms_by_rfc or {}

    for inv in invoices:
        inv.direction = "issued" if inv.emisor_rfc == own_rfc else "received"
        if inv.tipo == INGRESO and inv.metodo_pago == "PPD":
            terms = terms_by_rfc.get(inv.counterparty_rfc, net_terms_days)
            inv.due_date = inv.fecha + timedelta(days=terms)
        elif inv.tipo == INGRESO and inv.metodo_pago == "PUE":
            inv.due_date = inv.fecha          # settled on issue
        # Payroll keeps due_date None: its date comes from the bill calendar, not here.

    return Batch(own_rfc=own_rfc, own_name=own_name, invoices=invoices, skipped=skipped)


def demo() -> None:
    """Self-check against the generated mocks."""
    root = Path(__file__).parent.parent / "mocks" / "out" / "cfdi"
    dirs = sorted(p for p in root.iterdir() if p.is_dir())
    assert dirs, f"no mock CFDI under {root} — run mocks/generate.py --dry-run first"

    for d in dirs:
        batch = parse_dir(d)
        assert not batch.skipped, f"unparsed files: {batch.skipped}"
        assert batch.own_rfc == d.name, f"inferred {batch.own_rfc}, dir says {d.name}"

        # Every document must land on one side.
        assert all(i.direction in ("issued", "received") for i in batch.invoices)
        # Payroll is ours and carries the nomina complement.
        assert all(i.direction == "issued" for i in batch.payroll)
        # Receivables are issued PPD with a derived due date.
        for r in batch.receivables:
            assert r.due_date == r.fecha + timedelta(days=NET_TERMS_DAYS)
            assert r.counterparty_rfc != batch.own_rfc
        # Payables come from somebody else.
        for p in batch.payables:
            assert p.emisor_rfc != batch.own_rfc

        print(f"{batch.own_name:<30} {batch.own_rfc}  "
              f"docs={len(batch.invoices):>3}  receivables={len(batch.receivables):>2}  "
              f"payables={len(batch.payables):>3}  payroll={len(batch.payroll)}")

    print("cfdi_parser: all checks passed")


if __name__ == "__main__":
    demo()
