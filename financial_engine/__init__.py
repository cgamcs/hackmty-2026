"""Explainable 30-day working-capital engine for NEXUS."""

from .engine import FinancialEngine
from .contracts import scenario_from_dict, snapshot_from_dict
from .adapters import snapshot_from_mock_files, snapshot_from_sources
from .cfdi_parser import parse_cfdi, parse_cfdi_directory
from .models import (
    BusinessSnapshot,
    CashFlow,
    ForecastResult,
    FinancingDecision,
    FinancingStatus,
    GapType,
    Obligation,
    Receivable,
    StressScenario,
)

__all__ = [
    "BusinessSnapshot",
    "CashFlow",
    "FinancialEngine",
    "ForecastResult",
    "FinancingDecision",
    "FinancingStatus",
    "GapType",
    "Obligation",
    "Receivable",
    "StressScenario",
    "scenario_from_dict",
    "snapshot_from_dict",
    "snapshot_from_mock_files",
    "snapshot_from_sources",
    "parse_cfdi",
    "parse_cfdi_directory",
]
