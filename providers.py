"""
External forecast provider for PegelSync
=======================================

PegelSync's water-level forecast is produced by the in-house statistical
model in `forecast.py` (a rolling-origin backtest-validated local
linear-trend + persistence blend with 90% empirical prediction intervals).

Why this module exists (and why there is no live EFAS call):
  The calibrated **EFAS** (European Flood Awareness System) hydrological
  forecast was originally intended as the primary source. However, the
  anonymous EFAS REST API (efas.forest.jrc.ec.europa.eu) is
  **decommissioned** as of 2026 — it no longer resolves (DNS-dead), and
  EFAS now requires a Copernicus Climate Data Store (CDS) account + API
  key + the `cdsapi` client + grid->point interpolation. That conflicts
  with PegelSync's zero-dependency, paste-into-Lambda design.

  Rather than take on an external dependency, the validated local model is
  the primary forecast. It is NOT a black box: its skill is measured
  against persistence on a rolling-origin backtest, and untrustworthy
  forecasts are flagged via `forecast_skill` instead of over-claimed.

The `forecast_source` field stays set to "local" and is preserved so a
real authoritative feed (a future EFAS-CDS integration, a German state
HVZ/ELWIS feed, etc.) can be slotted in later WITHOUT touching the
Lambda or the UIs — they already read `forecast_source` and render
"EFAS (calibrated)" vs "Local model" accordingly.

Output shape (stable contract for lambda_function.py + both frontends):
    {
        "forecast_ok": bool,
        "forecast_skill": bool,
        "forecast_source": "local",
        "forecast_phi": float | None,
        "forecast_drift_m_per_h": float | None,
        "forecast_6h_m", "forecast_12h_m",
        "forecast_24h_m", "forecast_48h_m": float | None,
        "forecast_6h_lower_m", "forecast_6h_upper_m",
        "forecast_24h_lower_m", "forecast_24h_upper_m": float | None,
        "forecast_n": int,
    }
"""

# Local statistical model (stdlib-only) — the primary (and only) forecast source.
import forecast as local_forecast


def forecast_station(station_config, measurements,
                     precip_24h_mm=0.0, precip_48h_mm=0.0):
    """Forecast entry point used by the Lambda.

    Delegates to `forecast.py`. The `station_config` argument is accepted for
    API compatibility (a future external provider may use lat/lon) but the
    local model only needs the measurement history.

    Returns {} if there isn't enough history.
    """
    fit = local_forecast.fit_forecast(
        *local_forecast.measurements_to_arrays(measurements),
        precip_24h_mm, precip_48h_mm)
    if not fit["ok"]:
        return {
            "forecast_ok": False,
            "forecast_skill": False,
            "forecast_source": "local",
            "forecast_phi": None,
            "forecast_drift_m_per_h": None,
            "forecast_6h_m": None, "forecast_12h_m": None,
            "forecast_24h_m": None, "forecast_48h_m": None,
            "forecast_6h_lower_m": None, "forecast_6h_upper_m": None,
            "forecast_24h_lower_m": None, "forecast_24h_upper_m": None,
            "forecast_n": fit["n"],
        }
    f = fit["forecasts"]
    return {
        "forecast_ok": True,
        "forecast_skill": fit["skill"],
        "forecast_source": "local",
        "forecast_phi": fit["phi"],
        "forecast_drift_m_per_h": fit["drift_m_per_h"],
        "forecast_6h_m": f[6]["mean_m"],
        "forecast_12h_m": f[12]["mean_m"],
        "forecast_24h_m": f[24]["mean_m"],
        "forecast_48h_m": f[48]["mean_m"],
        "forecast_6h_lower_m": f[6]["lower_m"],
        "forecast_6h_upper_m": f[6]["upper_m"],
        "forecast_24h_lower_m": f[24]["lower_m"],
        "forecast_24h_upper_m": f[24]["upper_m"],
        "forecast_n": fit["n"],
    }
