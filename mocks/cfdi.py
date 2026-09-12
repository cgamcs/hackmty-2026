"""CFDI 4.0 XML writer for mock data.

Structurally realistic, NOT SAT-valid: `Sello`, `Certificado` and the timbre UUID are
fabricated because a real one needs a CSD certificate. Consequence for the parser:
it must never validate the seal, or it can never be tested.

Reference: Anexo 20 (CFDI 4.0) and the nomina12 standard.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from xml.sax.saxutils import quoteattr

IVA = 0.16
MOCK_SELLO = "MOCK" + "A" * 60
MOCK_CERT = "MOCK" + "B" * 60
NO_CERTIFICADO = "00001000000509846663"

# Catalogue codes actually used, kept narrow on purpose.
REGIMEN_PERSONA_MORAL = "601"
USO_GASTOS_GENERAL = "G03"
CLAVE_PROD_ABARROTES = "50202306"   # Alimentos preparados / abarrotes
CLAVE_UNIDAD = "H87"                # Pieza
FORMA_POR_DEFINIR = "99"
FORMA_TRANSFERENCIA = "03"
FORMA_EFECTIVO = "01"


def _attrs(pairs: dict[str, str]) -> str:
    return " ".join(f"{k}={quoteattr(str(v))}" for k, v in pairs.items() if v is not None)


def _money(x: float) -> str:
    return f"{x:.2f}"


def _timbre(fecha: str) -> str:
    return (
        '  <cfdi:Complemento>\n'
        '    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" '
        + _attrs({
            "Version": "1.1",
            "UUID": str(uuid.uuid4()).upper(),
            "FechaTimbrado": fecha,
            "RfcProvCertif": "SAT970701NN3",
            "SelloCFD": MOCK_SELLO,
            "NoCertificadoSAT": NO_CERTIFICADO,
            "SelloSAT": MOCK_SELLO,
        })
        + "/>\n"
        "  </cfdi:Complemento>\n"
    )


def _comprobante(
    *,
    tipo: str,
    fecha: str,
    subtotal: float,
    total: float,
    metodo_pago: str | None,
    forma_pago: str,
    lugar: str,
    serie: str,
    folio: int,
    emisor: dict,
    receptor: dict,
    conceptos_xml: str,
    impuestos_xml: str,
    complemento_extra: str = "",
) -> str:
    root = _attrs({
        "Version": "4.0",
        "Serie": serie,
        "Folio": str(folio),
        "Fecha": fecha,
        "Sello": MOCK_SELLO,
        "NoCertificado": NO_CERTIFICADO,
        "Certificado": MOCK_CERT,
        "SubTotal": _money(subtotal),
        "Moneda": "MXN",
        "Total": _money(total),
        "TipoDeComprobante": tipo,
        "Exportacion": "01",
        "MetodoPago": metodo_pago,
        "FormaPago": forma_pago,
        "LugarExpedicion": lugar,
    })
    complemento = complemento_extra or _timbre(fecha)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 '
        'http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" '
        f"{root}>\n"
        f"  <cfdi:Emisor {_attrs(emisor)}/>\n"
        f"  <cfdi:Receptor {_attrs(receptor)}/>\n"
        f"{conceptos_xml}"
        f"{impuestos_xml}"
        f"{complemento}"
        "</cfdi:Comprobante>\n"
    )


def _concepto_block(descripcion: str, base: float) -> tuple[str, str]:
    iva = round(base * IVA, 2)
    traslado = _attrs({
        "Base": _money(base), "Impuesto": "002", "TipoFactor": "Tasa",
        "TasaOCuota": "0.160000", "Importe": _money(iva),
    })
    conceptos = (
        "  <cfdi:Conceptos>\n"
        f"    <cfdi:Concepto {_attrs({
            'ClaveProdServ': CLAVE_PROD_ABARROTES, 'Cantidad': '1.00',
            'ClaveUnidad': CLAVE_UNIDAD, 'Descripcion': descripcion,
            'ValorUnitario': _money(base), 'Importe': _money(base), 'ObjetoImp': '02',
        })}>\n"
        "      <cfdi:Impuestos>\n"
        "        <cfdi:Traslados>\n"
        f"          <cfdi:Traslado {traslado}/>\n"
        "        </cfdi:Traslados>\n"
        "      </cfdi:Impuestos>\n"
        "    </cfdi:Concepto>\n"
        "  </cfdi:Conceptos>\n"
    )
    impuestos = (
        f'  <cfdi:Impuestos TotalImpuestosTrasladados="{_money(iva)}">\n'
        "    <cfdi:Traslados>\n"
        f"      <cfdi:Traslado {traslado}/>\n"
        "    </cfdi:Traslados>\n"
        "  </cfdi:Impuestos>\n"
    )
    return conceptos, impuestos


def factura(
    *,
    emisor_rfc: str, emisor_nombre: str,
    receptor_rfc: str, receptor_nombre: str, receptor_zip: str,
    base: float, fecha: date, serie: str, folio: int, lugar: str,
    metodo_pago: str,          # "PPD" (credit) or "PUE" (already paid)
    descripcion: str = "Venta de mercancia de abarrotes",
) -> str:
    """TipoDeComprobante=I. PPD is an open receivable; PUE is already collected."""
    conceptos, impuestos = _concepto_block(descripcion, base)
    return _comprobante(
        tipo="I",
        fecha=datetime.combine(fecha, datetime.min.time()).replace(hour=11, minute=30).isoformat(),
        subtotal=base, total=round(base * (1 + IVA), 2),
        metodo_pago=metodo_pago,
        forma_pago=FORMA_POR_DEFINIR if metodo_pago == "PPD" else FORMA_TRANSFERENCIA,
        lugar=lugar, serie=serie, folio=folio,
        emisor={"Rfc": emisor_rfc, "Nombre": emisor_nombre,
                "RegimenFiscal": REGIMEN_PERSONA_MORAL},
        receptor={"Rfc": receptor_rfc, "Nombre": receptor_nombre,
                  "DomicilioFiscalReceptor": receptor_zip,
                  "RegimenFiscalReceptor": REGIMEN_PERSONA_MORAL,
                  "UsoCFDI": USO_GASTOS_GENERAL},
        conceptos_xml=conceptos, impuestos_xml=impuestos,
    )


def nomina(
    *,
    emisor_rfc: str, emisor_nombre: str,
    receptor_rfc: str, receptor_nombre: str, receptor_zip: str,
    total_neto: float, fecha: date, serie: str, folio: int, lugar: str,
    dias_pagados: int = 15,
) -> str:
    """TipoDeComprobante=N with the nomina12:Nomina complement.

    This pair is what makes payroll unambiguously identifiable — and therefore a
    hard-dated obligation the action ladder must never propose shifting.
    """
    fecha_iso = datetime.combine(fecha, datetime.min.time()).replace(hour=9).isoformat()
    percepcion = _attrs({
        "TipoPercepcion": "001", "Clave": "001", "Concepto": "Sueldos",
        "ImporteGravado": _money(total_neto), "ImporteExento": "0.00",
    })
    complemento = (
        "  <cfdi:Complemento>\n"
        '    <nomina12:Nomina xmlns:nomina12="http://www.sat.gob.mx/nomina12" '
        + _attrs({
            "Version": "1.2", "TipoNomina": "O",
            "FechaPago": fecha.isoformat(),
            "FechaInicialPago": fecha.isoformat(),
            "FechaFinalPago": fecha.isoformat(),
            "NumDiasPagados": f"{dias_pagados}.000",
            "TotalPercepciones": _money(total_neto),
            "TotalDeducciones": "0.00",
        })
        + ">\n"
        f'      <nomina12:Emisor RegistroPatronal="B5510768108"/>\n'
        f'      <nomina12:Receptor {_attrs({
            "Curp": "XEXX010101HNEXXXA4", "TipoContrato": "01", "TipoRegimen": "02",
            "NumEmpleado": "001", "PeriodicidadPago": "04",
            "NumSeguridadSocial": "12345678901",
            "FechaInicioRelLaboral": "2022-01-15", "Antiguedad": "P180W",
            "SalarioDiarioIntegrado": _money(total_neto / max(dias_pagados, 1)),
            "ClaveEntFed": "GTO",
        })}/>\n'
        f'      <nomina12:Percepciones TotalSueldos="{_money(total_neto)}" '
        f'TotalGravado="{_money(total_neto)}" TotalExento="0.00">\n'
        f"        <nomina12:Percepcion {percepcion}/>\n"
        "      </nomina12:Percepciones>\n"
        "    </nomina12:Nomina>\n"
        "  </cfdi:Complemento>\n"
    )
    return _comprobante(
        tipo="N", fecha=fecha_iso,
        subtotal=total_neto, total=total_neto,
        metodo_pago=None, forma_pago=FORMA_TRANSFERENCIA,
        lugar=lugar, serie=serie, folio=folio,
        emisor={"Rfc": emisor_rfc, "Nombre": emisor_nombre,
                "RegimenFiscal": REGIMEN_PERSONA_MORAL},
        receptor={"Rfc": receptor_rfc, "Nombre": receptor_nombre,
                  "DomicilioFiscalReceptor": receptor_zip,
                  "RegimenFiscalReceptor": "605",
                  "UsoCFDI": "CN01"},
        conceptos_xml=(
            "  <cfdi:Conceptos>\n"
            f"    <cfdi:Concepto {_attrs({
                'ClaveProdServ': '84111505', 'Cantidad': '1.00',
                'ClaveUnidad': 'ACT', 'Descripcion': 'Pago de nomina',
                'ValorUnitario': _money(total_neto), 'Importe': _money(total_neto),
                'Descuento': '0.00', 'ObjetoImp': '01',
            })}/>\n"
            "  </cfdi:Conceptos>\n"
        ),
        impuestos_xml="",
        complemento_extra=complemento,
    )
