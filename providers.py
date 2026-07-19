"""
External forecast providers for PegelSync
=========================================

Primary source: **EFAS** (European Flood Awareness System, Copernicus JRC) —
a calibrated continental hydrological forecast. Where an EFAS point forecast is
available for a station's coordinates, we use it as the authoritative number.

Fallback source: the local `forecast.py` statistical model. EFAS can be
unavailable for a given coordinate, rate-limited, or the network can fail; in
any of those cases we transparently fall back to the in-house model so every
station still gets a forecast.

Both providers return the SAME normalised shape so the Lambda can treat them
interchangeably:

    {
        "ok": bool,
        "source": "efas" | "local",
        "skill": bool,                 # is this forecast to be trusted?
        "phi": float | None,
        "drift_m_per_h": float | None,
        "n": int,
        "forecasts": {
            6:  {"mean_m", "lower_m", "upper_m", "pi90"},
            12: {...}, 24: {...}, 48: {...}
        }
    }

The Lambda merges this into the station status entry and tags the source in
`forecast_source` so the UI can show where the number came from.
"""

import json
import math
import os
import urllib.request
import urllib.error

# Local statistical model (stdlib-only) — used as the fallback.
import forecast as local_forecast

# When this env var is set (e.g. EFAS_DIAGNOSTIC=1), the Lambda logs the
# raw EFAS HTTP status + a trimmed response body per station. Use it ONCE in
# AWS to capture the real EFAS schema (then send the log to the assistant so
# the parser can be locked to the exact field names). Off by default.
EFAS_DIAGNOSTIC = os.environ.get("EFAS_DIAGNOSTIC") == "1"

# Diagnostic lines collected during a run (only when EFAS_DIAGNOSTIC=1) and
# surfaced in the Lambda's JSON response so they're visible in the Test panel
# without hunting CloudWatch. Cleared at the start of each forecast_station call.
_EFAS_DIAG_LINES = []


def _log(msg):
    # stdout -> CloudWatch in Lambda, AND collected for the JSON response.
    print(msg)
    if EFAS_DIAGNOSTIC:
        _EFAS_DIAG_LINES.append(msg)


def efas_diag_reset():
    _EFAS_DIAG_LINES.clear()


def efas_diag_lines():
    return list(_EFAS_DIAG_LINES)

# ── EFAS configuration ──────────────────────────────────────────────────────
# Public EFAS API (Copernicus JRC). Queried by geographic coordinates, which
# we already have for every station in STATIONS, so no station-code mapping is
# needed. The Lambda runs in AWS (eu-north-1) where this host is reachable;
# it is intentionally wrapped in a strict timeout + try/except so a failure
# degrades to the local model instead of breaking the run.
EFAS_BASE = "https://efas.forest.jrc.ec.europa.eu/api"
EFAS_TIMEOUT_S = 8.0
EFAS_HORIZONS_H = (6, 12, 24, 48)

# EFAS returns forecasts in metres above sea level (same datum as PEGELONLINE
# "W" water level), so no unit conversion is required.


def _fetch_efas_point(lat, lon, timeout=EFAS_TIMEOUT_S):
    """Fetch the raw EFAS point/station forecast JSON for (lat, lon).

    Returns the parsed dict, or None on any failure (timeout, HTTP error,
    empty/malformed body, missing expected keys). Never raises.
    """
    url = f"{EFAS_BASE}/forecast?lat={lat}&lon={lon}&owo=true"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PegelSync/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", resp.getcode())
            body = resp.read().decode("utf-8")
            data = json.loads(body)
        if EFAS_DIAGNOSTIC:
            _log(f"[EFAS-DIAG] lat={lat} lon={lon} status={status} "
                 f"bytes={len(body)} preview={body[:600]!r}")
        if not isinstance(data, dict) or not data:
            return None
        return data
    except urllib.error.HTTPError as e:
        if EFAS_DIAGNOSTIC:
            _log(f"[EFAS-DIAG] lat={lat} lon={lon} HTTPError={e.code} "
                 f"body={(e.read().decode('utf-8', 'replace') or '')[:400]!r}")
        return None
    except Exception as e:
        if EFAS_DIAGNOSTIC:
            _log(f"[EFAS-DIAG] lat={lat} lon={lon} ERROR={type(e).__name__}: {e}")
        return None


def _parse_efas_forecasts(raw):
    """Normalise an EFAS response into our {h: {mean_m, lower_m, upper_m, pi90}}
    shape, or return None if it can't be parsed.

    EFAS station forecasts expose time series such as:
        - "flow" / "discharge" (m3/s)  — not what we want
        - "water_level" / "level" (m)  — the value comparable to PEGELONLINE W
    plus a deterministic ("det") series and an ensemble spread we use for the
    prediction interval. Field names vary across EFAS API versions, so we probe
    a small set of plausible keys defensively.
    """
    if raw is None:
        return None

    # The forecast payload sits under a few possible envelopes.
    payload = raw
    for key in ("forecast", "point_forecast", "data", "return"):
        if isinstance(payload.get(key), (dict, list)):
            payload = payload[key]
            break

    series = None
    for lvl_key in ("water_level", "level", "waterlevel", "W"):
        cand = payload.get(lvl_key)
        if isinstance(cand, dict) or isinstance(cand, list):
            series = cand
            break
    # Common EFAS envelope nests under "det" (deterministic) for the mean and
    # "ens" (ensemble) / "low"+"high" for the spread.
    if series is None:
        det = payload.get("det") or payload.get("deterministic")
        if isinstance(det, dict):
            for lvl_key in ("water_level", "level", "W"):
                if isinstance(det.get(lvl_key), (dict, list)):
                    series = det[lvl_key]
                    break
    if series is None:
        return None

    # `series` should be a time-indexed list of {timestamp, value} (mean) plus
    # optional lower/upper bounds. Normalise to per-horizon means.
    def _values(block):
        if isinstance(block, list):
            return [float(p.get("value", p.get("v", 0))) for p in block
                    if isinstance(p, dict)]
        if isinstance(block, dict):
            # some versions key by timestamp
            return [float(v) for v in block.values() if isinstance(v, (int, float))]
        return None

    mean_vals = _values(series)
    if not mean_vals:
        return None

    # Optional ensemble spread for intervals.
    spread = None
    for spread_key in ("ens", "ensemble", "uncertainty"):
        if isinstance(payload.get(spread_key), (dict, list)):
            spread = payload[spread_key]
            break
    lo_vals = _values(spread.get("low")) if isinstance(spread, dict) else None
    hi_vals = _values(spread.get("high")) if isinstance(spread, dict) else None
    if lo_vals is None or hi_vals is None:
        # Fall back to a symmetric 10% empirical band if no ensemble given.
        lo_vals = [v * 0.95 for v in mean_vals]
        hi_vals = [v * 1.05 for v in mean_vals]

    n = min(len(mean_vals), len(lo_vals), len(hi_vals))
    if n < 2:
        return None

    # Map the (roughly hourly) series to our horizon buckets by index.
    step = max(1, n // EFAS_HORIZONS_H[-1])
    out = {}
    for h in EFAS_HORIZONS_H:
        idx = min(n - 1, h // step)
        mean_m = mean_vals[idx]
        lo = lo_vals[idx]
        hi = hi_vals[idx]
        half = max(abs(mean_m - lo), abs(hi - mean_m))
        if not (math.isfinite(mean_m) and math.isfinite(half)):
            return None
        out[h] = {
            "mean_m": round(mean_m, 3),
            "lower_m": round(lo, 3),
            "upper_m": round(hi, 3),
            "pi90": round(half, 3),
        }
    return out


def efas_forecast(lat, lon):
    """Return the normalized EFAS forecast for a coordinate, or None."""
    raw = _fetch_efas_point(lat, lon)
    return _parse_efas_forecasts(raw)


def forecast_station(station_config, measurements,
                     precip_24h_mm=0.0, precip_48h_mm=0.0):
    """Unified forecast entry point used by the Lambda.

    Tries EFAS first (by the station's lat/lon). If EFAS is unavailable or its
    response can't be parsed, falls back to the local statistical model. The
    returned dict always carries a `source` field ("efas" | "local") and the
    same normalized shape, so downstream code is unchanged.

    Returns {} if even the fallback has insufficient data.
    """
    lat = station_config.get("lat")
    lon = station_config.get("lon")

    if EFAS_DIAGNOSTIC:
        efas_diag_reset()

    # 1) Primary: EFAS (calibrated hydrological forecast).
    if lat is not None and lon is not None:
        efas = efas_forecast(lat, lon)
        if efas:
            return {
                "ok": True,
                "source": "efas",
                "skill": True,            # EFAS is an authoritative model
                "phi": None,
                "drift_m_per_h": None,
                "n": len(efas),
                "forecasts": efas,
            }

    # 2) Fallback: local statistical model.
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
