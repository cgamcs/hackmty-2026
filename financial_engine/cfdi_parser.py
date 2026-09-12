from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree

from .models import Receivable


CFDI_NS = "http://www.sat.gob.mx/cfd/4"
NOMINA_NS = "http://www.sat.gob.mx/nomina12"


@dataclass(frozen=True)
class ParsedCFDI:
    path: Path
    kind: str
    series: str
    folio: str
    issued_at: date
    total: float
    payment_method: str | None
    issuer_rfc: str
    issuer_name: str
    receiver_rfc: str
    receiver_name: str
    has_payroll_complement: bool

    @property
    def document_id(self) -> str:
        return f"{self.series}{self.folio}"


def parse_cfdi(path: str | Path) -> ParsedCFDI:
    """Parse only the fields used by the forecast; mock seals are not validated."""

    path = Path(path)
    root = ElementTree.parse(path).getroot()
    issuer = root.find(f"{{{CFDI_NS}}}Emisor")
    receiver = root.find(f"{{{CFDI_NS}}}Receptor")
    if issuer is None or receiver is None:
        raise ValueError(f"{path}: CFDI Emisor/Receptor missing")
    raw_date = root.attrib["Fecha"]
    return ParsedCFDI(
        path=path,
        kind=root.attrib["TipoDeComprobante"],
        series=root.attrib.get("Serie", ""),
        folio=root.attrib.get("Folio", ""),
        issued_at=datetime.fromisoformat(raw_date).date(),
        total=float(root.attrib["Total"]),
        payment_method=root.attrib.get("MetodoPago"),
        issuer_rfc=issuer.attrib["Rfc"],
        issuer_name=issuer.attrib.get("Nombre", issuer.attrib["Rfc"]),
        receiver_rfc=receiver.attrib["Rfc"],
        receiver_name=receiver.attrib.get("Nombre", receiver.attrib["Rfc"]),
        has_payroll_complement=root.find(f".//{{{NOMINA_NS}}}Nomina") is not None,
    )


def parse_cfdi_directory(path: str | Path) -> list[ParsedCFDI]:
    return [parse_cfdi(file) for file in sorted(Path(path).glob("*.xml"))]


def open_receivables_from_cfdi(
    path: str | Path,
    owner_rfc: str,
    settled_document_ids: set[str] | None = None,
    net_terms_days: int = 30,
    collection_probability: float = 0.85,
) -> list[Receivable]:
    settled_document_ids = settled_document_ids or set()
    receivables: list[Receivable] = []
    for document in parse_cfdi_directory(path):
        is_open_sale = (
            document.kind == "I"
            and document.payment_method == "PPD"
            and document.issuer_rfc == owner_rfc
            and document.document_id not in settled_document_ids
        )
        if not is_open_sale:
            continue
        receivables.append(
            Receivable(
                id=document.document_id,
                due_date=document.issued_at + timedelta(days=net_terms_days),
                amount=document.total,
                customer=document.receiver_name,
                collection_probability=collection_probability,
                earliest_collection_date=None,
                early_payment_discount=0.02,
            )
        )
    return receivables
