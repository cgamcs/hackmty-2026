"""Engine parameters.

NET_TERMS_DAYS and HORIZON_DAYS both default to 30 but are unrelated quantities:
one is a commercial payment term, the other is how far ahead we project. Keeping them
separate means changing the forecast horizon cannot silently reprice every client's
credit terms.
"""

# How long a client takes to pay a PPD invoice. CFDI records that payment is deferred
# but never when it is due — terms are commercial, not fiscal — so this is our default.
# Per-client overrides belong in Supabase, keyed by the client's RFC.
NET_TERMS_DAYS = 30

# Liquidity projection window.
HORIZON_DAYS = 30

# Reconciliation tolerances.
AMOUNT_TOLERANCE = 0.005   # 0.5% — absorbs IVA rounding between XML and bank amounts
DATE_WINDOW_DAYS = 7       # a settlement may post a few days off the expected date

# Share of an open receivable we expect to actually collect on time.
COLLECTION_PROBABILITY = 0.85
