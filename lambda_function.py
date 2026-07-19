"""
Serverless Hydrological Flood Risk Alert System
================================================
This AWS Lambda function fetches real-time river gauge data from Germany's
PEGELONLINE REST API, checks whether the current water level exceeds a
safety threshold, and — if it does — saves a JSON alert payload to an
Amazon S3 bucket.  It also ALWAYS writes a `latest_status.json` file
containing the current status of every monitored station, which powers
the live frontend dashboard.

Zero-dependency design: this script uses ONLY Python standard-library
modules (json, os, datetime, urllib) plus boto3 which is pre-installed
in the AWS Lambda runtime.  No pip packages required.
"""

# ── Imports ──────────────────────────────────────────────────────────────

import json
import os
from datetime import datetime, timezone, timedelta
import urllib.request
import urllib.error
import concurrent.futures

# We use quote to safely URL-encode German umlauts (e.g. KÖLN -> K%C3%96LN)
from urllib.parse import quote
import boto3

# Local module: the statistically-validated water-level forecast engine.
# Keep it stdlib-only so the Lambda stays zero-dependency.
try:
    import forecast as forecast_mod
except Exception:  # pragma: no cover — forecast.py lives alongside this file
    forecast_mod = None


# ── Configuration ────────────────────────────────────────────────────────

# The base URL for Germany's PEGELONLINE REST API (v2) — this is the modern
# version of the free, public service that provides real-time water-level
# data for rivers across Germany.  The legacy "rest2009" endpoint is
# deprecated and returns 404 for many stations.
PEGELONLINE_BASE_URL = "https://www.pegelonline.wsv.de/webservices/rest-api/v2"

# List of target stations and their respective flood thresholds in metres.
# 15-station national network across 5 major river basins.
MONITORED_STATIONS = [

    # ── Rhine Basin ──────────────────────────────────────────────────
    {
        "station_id": "KÖLN",
        "label": "Cologne (Rhine)",
        "threshold_m": 6.20,
        "lat": 50.936,
        "lon": 6.963,
    },
    {
        "station_id": "MAXAU",
        "label": "Maxau (Rhine)",
        "threshold_m": 7.00,
        "lat": 49.039,
        "lon": 8.307,
    },
    {
        "station_id": "COCHEM",
        "label": "Cochem (Moselle)",
        "threshold_m": 6.20,
        "lat": 50.146,
        "lon": 7.169,
    },
    {
        "station_id": "KAUB",
        "label": "Kaub (Rhine)",
        "threshold_m": 4.60,
        "lat": 50.084,
        "lon": 7.765,
    },
    {
        "station_id": "WÜRZBURG",
        "label": "Würzburg (Main)",
        "threshold_m": 4.00,
        "lat": 49.794,
        "lon": 9.926,
    },
    {
        "station_id": "HEIDELBERG UP",
        "label": "Heidelberg (Neckar)",
        "threshold_m": 4.40,
        "lat": 49.414,
        "lon": 8.709,
    },

    # ── Danube Basin ─────────────────────────────────────────────────
    {
        "station_id": "PASSAU DONAU",
        "label": "Passau (Danube)",
        "threshold_m": 7.00,
        "lat": 48.577,
        "lon": 13.476,
    },
    {
        "station_id": "PFELLING",
        "label": "Straubing (Danube)",
        "threshold_m": 4.50,
        "lat": 48.889,
        "lon": 12.574,
    },

    # ── Elbe Basin ───────────────────────────────────────────────────
    {
        "station_id": "DRESDEN",
        "label": "Dresden (Elbe)",
        "threshold_m": 4.00,
        "lat": 51.054,
        "lon": 13.738,
    },
    {
        "station_id": "MAGDEBURG-STROMBRÜCKE",
        "label": "Magdeburg (Elbe)",
        "threshold_m": 4.30,
        "lat": 52.127,
        "lon": 11.645,
    },
    {
        "station_id": "SCHÖNA",
        "label": "Schöna (Elbe)",
        "threshold_m": 4.00,
        "lat": 50.873,
        "lon": 14.239,
    },

    # ── Weser Basin ──────────────────────────────────────────────────
    {
        "station_id": "VEGESACK",
        "label": "Bremen (Weser)",
        "threshold_m": 8.90,
        "lat": 53.076,
        "lon": 8.802,
    },
    {
        "station_id": "HANN.MUENDEN",
        "label": "Hann. Münden (Weser)",
        "threshold_m": 4.00,
        "lat": 51.418,
        "lon": 9.650,
    },

    # ── Elbe Estuary & Oder Basin ────────────────────────────────────
    {
        "station_id": "HAMBURG ST. PAULI",
        "label": "Hamburg (Elbe)",
        "threshold_m": 8.70,
        "lat": 53.545,
        "lon": 9.967,
    },
    {
        "station_id": "FRANKFURT1 (ODER)",
        "label": "Frankfurt/Oder (Oder)",
        "threshold_m": 4.00,
        "lat": 52.348,
        "lon": 14.555,
    },
]

S3_BUCKET_NAME = os.environ.get("ALERT_BUCKET_NAME", "aryan-hydro-alerts-882611-2026")


# ── Helper Functions ─────────────────────────────────────────────────────

def process_station(station_config: dict) -> dict:
    """
    Process a single station: fetch current water level, 48h history, current discharge,
    and 48h precipitation forecast.

    Parameters
    ----------
    station_config : dict
        The configuration dictionary for the station.

    Returns
    -------
    dict
        A dictionary with enriched station data including trends and forecasts.
    """
    station_id = station_config["station_id"]
    lat = station_config["lat"]
    lon = station_config["lon"]
    encoded_name = quote(station_id, safe="")

    # 1. Fetch water-level history.
    #   - A short (48h) window drives the in-dashboard trend / delta / rate.
    #   - A LONG (30d) window feeds the backtest-validated forecast engine,
    #     which needs enough history to size its prediction intervals.
    history_url = f"{PEGELONLINE_BASE_URL}/stations/{encoded_name}/W/measurements.json?start=P2D"
    history_long_url = f"{PEGELONLINE_BASE_URL}/stations/{encoded_name}/W/measurements.json?start=P30D"
    
    water_level_m = None
    timestamp = "unknown"
    unit = "cm"
    trend = "stable"
    delta_24h_m = 0.0
    rate_of_change_cm_hr = 0.0
    measurements_long = []

    try:
        with urllib.request.urlopen(history_url, timeout=10) as response:
            measurements = json.loads(response.read().decode("utf-8"))
        
        if measurements:
            latest = measurements[-1]
            raw_value = latest.get("value", 0)
            unit = latest.get("unit", "cm")
            timestamp = latest.get("timestamp", "unknown")
            water_level_m = raw_value / 100.0 if unit == "cm" else raw_value

            # Calculate trend using 24h moving average comparison
            now_dt = datetime.fromisoformat(timestamp)
            today_start = now_dt - timedelta(hours=24)
            yesterday_start = now_dt - timedelta(hours=48)

            today_vals = [m["value"] for m in measurements if datetime.fromisoformat(m["timestamp"]) >= today_start]
            yesterday_vals = [m["value"] for m in measurements if yesterday_start <= datetime.fromisoformat(m["timestamp"]) < today_start]

            if today_vals and yesterday_vals:
                today_mean = sum(today_vals) / len(today_vals)
                yesterday_mean = sum(yesterday_vals) / len(yesterday_vals)
                diff = today_mean - yesterday_mean
                
                # Convert to metres if necessary for the threshold check
                diff_m = diff / 100.0 if unit == "cm" else diff
                
                # We use a percentage-of-threshold or a moving average to filter out tidal noise
                if diff_m > 0.05:
                    trend = "rising"
                elif diff_m < -0.05:
                    trend = "falling"

            # Delta 24h: compare latest to exactly 24h ago
            if today_vals:
                first_today = today_vals[0]
                delta_raw = raw_value - first_today
                delta_24h_m = delta_raw / 100.0 if unit == "cm" else delta_raw

            # Rate of change over last 6 hours
            six_hours_ago = now_dt - timedelta(hours=6)
            recent_vals = [m["value"] for m in measurements if datetime.fromisoformat(m["timestamp"]) >= six_hours_ago]
            if recent_vals and len(recent_vals) > 1:
                first_recent = recent_vals[0]
                # Assuming equidistant 15 min measurements, or roughly 6 hours
                diff_cm = raw_value - first_recent if unit == "cm" else (raw_value - first_recent) * 100.0
                rate_of_change_cm_hr = diff_cm / 6.0
    except Exception as e:
        print(f"[{station_id}] Error fetching water level history: {e}")

    # 1b. Fetch the long (30d) history used by the forecast engine.
    try:
        with urllib.request.urlopen(history_long_url, timeout=15) as response:
            measurements_long = json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"[{station_id}] Error fetching 30d history: {e}")

    # 2. Fetch current discharge (Q)
    discharge_m3s = None
    q_url = f"{PEGELONLINE_BASE_URL}/stations/{encoded_name}/Q/currentmeasurement.json"
    try:
        with urllib.request.urlopen(q_url, timeout=5) as response:
            q_data = json.loads(response.read().decode("utf-8"))
            discharge_m3s = q_data.get("value")
    except urllib.error.HTTPError as e:
        # 404 is expected for stations without Q data
        pass
    except Exception as e:
        print(f"[{station_id}] Error fetching discharge: {e}")

    # 3. Fetch precipitation forecast (Bright Sky API)
    precip_next_24h_mm = 0.0
    precip_next_48h_mm = 0.0
    precip_condition = "dry"
    
    try:
        now_utc = datetime.now(timezone.utc)
        date_str = now_utc.strftime("%Y-%m-%d")
        last_date_str = (now_utc + timedelta(days=2)).strftime("%Y-%m-%d")
        weather_url = f"https://api.brightsky.dev/weather?lat={lat}&lon={lon}&date={date_str}&last_date={last_date_str}"
        
        # Add a realistic User-Agent as a courtesy
        req = urllib.request.Request(weather_url, headers={'User-Agent': 'PegelSync/1.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            weather_data = json.loads(response.read().decode("utf-8"))
            weather = weather_data.get("weather", [])
            
            next_24h = now_utc + timedelta(hours=24)
            next_48h = now_utc + timedelta(hours=48)
            
            for w in weather:
                ts = datetime.fromisoformat(w["timestamp"])
                precip = w.get("precipitation", 0) or 0
                if now_utc <= ts < next_24h:
                    precip_next_24h_mm += precip
                if now_utc <= ts < next_48h:
                    precip_next_48h_mm += precip

            if precip_next_24h_mm > 10:
                precip_condition = "heavy"
            elif precip_next_24h_mm > 2:
                precip_condition = "moderate"
            elif precip_next_24h_mm > 0:
                precip_condition = "light"

    except Exception as e:
        print(f"[{station_id}] Error fetching weather forecast: {e}")

    # 4. Forecast (Phase 5): backtest-validated level prediction + 90% PIs.
    #    Runs purely on stdlib; degrades to forecast_ok=False if we lack data.
    forecast_fields = {}
    if forecast_mod is not None and measurements_long:
        try:
            forecast_fields = forecast_mod.forecast_station_payload(
                station_config, measurements_long,
                precip_24h_mm=precip_next_24h_mm,
                precip_48h_mm=precip_next_48h_mm,
            )
        except Exception as e:
            print(f"[{station_id}] Forecasting failed: {e}")
            forecast_fields = {"forecast_ok": False, "forecast_skill": False}

    return {
        "station": station_id,
        "label": station_config["label"],
        "water_level_m": water_level_m,
        "timestamp": timestamp,
        "unit": unit,
        "trend": trend,
        "delta_24h_m": round(delta_24h_m, 2),
        "rate_of_change_cm_hr": round(rate_of_change_cm_hr, 1),
        "discharge_m3s": discharge_m3s,
        "precip_next_24h_mm": round(precip_next_24h_mm, 1),
        "precip_next_48h_mm": round(precip_next_48h_mm, 1),
        "precip_condition": precip_condition,
        **forecast_fields,
    }


def build_alert_payload(station_data: dict, threshold: float) -> dict:
    """
    Build the JSON-serialisable alert payload that will be stored in S3.

    Parameters
    ----------
    station_data : dict
        The dictionary returned by `fetch_current_water_level`.
    threshold : float
        The flood threshold in metres that was exceeded.

    Returns
    -------
    dict
        A dictionary representing the alert, ready to be saved as JSON.
    """

    # Create a human-readable alert message.
    message = (
        f"⚠️ FLOOD ALERT: Water level at {station_data['station']} is "
        f"{station_data['water_level_m']:.2f} m, exceeding the threshold "
        f"of {threshold:.2f} m."
    )

    # Package everything into a single dictionary.
    payload = {
        "alert_type": "FLOOD_WARNING",
        "station": station_data["station"],
        "water_level_m": station_data["water_level_m"],
        "threshold_m": threshold,
        "measurement_timestamp": station_data["timestamp"],
        "alert_generated_at": datetime.now(timezone.utc).isoformat(),
        "message": message,
    }

    return payload


def save_alerts_to_s3(alerts_list: list, bucket_name: str) -> str:
    """
    Save the *combined* list of alert payloads as a single JSON file in S3.

    Parameters
    ----------
    alerts_list : list[dict]
        A list of alert dictionaries — one per station that exceeded its
        threshold during this invocation.
    bucket_name : str
        The name of the target S3 bucket.

    Returns
    -------
    str
        The S3 object key (filename) under which the alerts were saved.
    """

    s3_client = boto3.client("s3")

    # Generate a unique key per batch to retain historical alert logs
    timestamp_slug = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    object_key = f"alerts/{timestamp_slug}.json"

    combined_payload = {
        "alert_batch_generated_at": datetime.now(timezone.utc).isoformat(),
        "total_alerts": len(alerts_list),
        "alerts": alerts_list,
    }

    body = json.dumps(combined_payload, indent=2, ensure_ascii=False)

    s3_client.put_object(
        Bucket=bucket_name,
        Key=object_key,
        Body=body,
        ContentType="application/json",
    )

    return object_key


def save_latest_status_to_s3(stations_status: list, bucket_name: str) -> str:
    """
    Save a snapshot of ALL station statuses to `latest_status.json` in S3.

    This file is ALWAYS written — regardless of whether any alerts were
    triggered — so that the frontend dashboard can fetch it and display
    the current state of every monitored station.

    Parameters
    ----------
    stations_status : list[dict]
        A list of status dictionaries, one per station.  Each dict contains
        the station label, water level, threshold, timestamp, and a
        "status" field that is either "SAFE" or "ALERT".
    bucket_name : str
        The name of the target S3 bucket.

    Returns
    -------
    str
        The S3 object key (always "latest_status.json").
    """

    s3_client = boto3.client("s3")
    object_key = "latest_status.json"

    status_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stations_checked": len(stations_status),
        "stations": stations_status,
    }

    body = json.dumps(status_payload, indent=2, ensure_ascii=False)

    s3_client.put_object(
        Bucket=bucket_name,
        Key=object_key,
        Body=body,
        ContentType="application/json",
        CacheControl="max-age=300",
    )

    return object_key


# ── Lambda Handler ───────────────────────────────────────────────────────

def lambda_handler(event, context):
    """
    The entry point that AWS Lambda calls when this function is triggered.

    The handler loops through every station in MONITORED_STATIONS,
    fetches its latest water level, and:
      1. Collects alerts into a master list (saved to S3 only if non-empty).
      2. ALWAYS writes `latest_status.json` to S3 with the current state
         of every station — this powers the live frontend dashboard.

    Parameters
    ----------
    event : dict
        The event data passed by whatever triggered the Lambda (e.g. a
        CloudWatch scheduled rule). We don't use it here, but Lambda
        always passes it.
    context : object
        Runtime information provided by Lambda (request ID, time remaining,
        etc.). We don't use it here either, but it's always present.

    Returns
    -------
    dict
        A response dictionary with an HTTP-style statusCode and a body
        message describing what happened.
    """

    alerts_list = []
    all_stations_status = []

    # ── Step 1: Process all stations concurrently ────────────────────────
    def fetch_and_evaluate(station_config):
        label = station_config["label"]
        threshold = station_config["threshold_m"]
        print(f"📡 [{label}] Fetching data (W, Q, Precip) …")
        
        try:
            station_data = process_station(station_config)
            
            # If water_level_m is None, something failed
            if station_data["water_level_m"] is None:
                raise ValueError("Failed to retrieve water level data.")

            is_alert = station_data["water_level_m"] > threshold
            
            # Base status entry from the static config + live measurements.
            status_entry = {
                "label": label,
                "station_id": station_config["station_id"],
                "threshold_m": threshold,
                "lat": station_config["lat"],
                "lon": station_config["lon"],
                "status": "ALERT" if is_alert else "SAFE",
                "water_level_m": station_data["water_level_m"],
                "measurement_timestamp": station_data["timestamp"],
                "trend": station_data["trend"],
                "delta_24h_m": station_data["delta_24h_m"],
                "rate_of_change_cm_hr": station_data["rate_of_change_cm_hr"],
                "discharge_m3s": station_data["discharge_m3s"],
                "precip_next_24h_mm": station_data["precip_next_24h_mm"],
                "precip_next_48h_mm": station_data["precip_next_48h_mm"],
                "precip_condition": station_data["precip_condition"],
            }
            # Merge the forecast engine's fields (keys prefixed forecast_* plus
            # forecast_n / forecast_phi / forecast_drift_m_per_h), if present.
            for k, v in station_data.items():
                if k.startswith("forecast_"):
                    status_entry[k] = v
            
            alert_payload = None
            if is_alert:
                alert_payload = build_alert_payload(station_data, threshold)
                
            return (status_entry, alert_payload, None)
            
        except Exception as exc:
            print(f"   ❌ Failed to process {label}: {exc}")
            error_entry = {
                "label": label,
                "station_id": station_config["station_id"],
                "threshold_m": threshold,
                "lat": station_config["lat"],
                "lon": station_config["lon"],
                "status": "ERROR",
                "message": str(exc),
                "water_level_m": None,
                "measurement_timestamp": None,
                "trend": "stable",
                "delta_24h_m": 0.0,
                "rate_of_change_cm_hr": 0.0,
                "discharge_m3s": None,
                "precip_next_24h_mm": 0.0,
                "precip_next_48h_mm": 0.0,
                "precip_condition": "dry",
                "forecast_ok": False,
                "forecast_skill": False,
                "forecast_source": "local",
                "forecast_phi": None,
                "forecast_drift_m_per_h": None,
                "forecast_6h_m": None, "forecast_12h_m": None,
                "forecast_24h_m": None, "forecast_48h_m": None,
                "forecast_6h_lower_m": None, "forecast_6h_upper_m": None,
                "forecast_24h_lower_m": None, "forecast_24h_upper_m": None,
                "forecast_n": 0,
            }
            return (error_entry, None, str(exc))

    # Execute concurrent requests
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = executor.map(fetch_and_evaluate, MONITORED_STATIONS)

    for status_entry, alert_payload, error in results:
        all_stations_status.append(status_entry)
        if alert_payload:
            alerts_list.append(alert_payload)
            print(f"   🚨 Threshold exceeded at {status_entry['label']}! Alert generated.")
        elif not error:
            print(f"   ✅ {status_entry['label']} processed successfully. Level: {status_entry['water_level_m']:.2f}m")

    # ── Step 3: Save combined alerts to S3 (only if any exist) ───────
    alert_s3_key = None
    if alerts_list:
        print(f"\n💾 {len(alerts_list)} alert(s) generated. Saving to S3 bucket: {S3_BUCKET_NAME} …")
        alert_s3_key = save_alerts_to_s3(alerts_list, S3_BUCKET_NAME)
        print(f"✅ Alerts saved to s3://{S3_BUCKET_NAME}/{alert_s3_key}")
    else:
        print("\n✅ All stations are within safe limits. No alert file created.")

    # ── Step 4: ALWAYS save latest_status.json for the dashboard ─────
    print(f"📊 Saving latest_status.json to s3://{S3_BUCKET_NAME}/ …")
    status_key = save_latest_status_to_s3(all_stations_status, S3_BUCKET_NAME)
    print(f"✅ Dashboard data saved to s3://{S3_BUCKET_NAME}/{status_key}")

    # ── Build the Lambda response ────────────────────────────────────
    response_body = {
        "result": "ALERTS_CREATED" if alerts_list else "NO_ALERTS",
        "stations_checked": len(MONITORED_STATIONS),
        "total_alerts": len(alerts_list),
        "status_s3_key": status_key,
    }

    # Surface EFAS diagnostic lines (only populated when EFAS_DIAGNOSTIC=1)
    # directly in the Test response so they're visible without CloudWatch.
    try:
        from providers import efas_diag_lines
        _diag = efas_diag_lines()
        if _diag:
            response_body["efas_diag"] = _diag
    except Exception:
        pass

    # Include the alert S3 key only if alerts were created.
    if alert_s3_key:
        response_body["alert_s3_key"] = alert_s3_key

    return {
        "statusCode": 200,
        "body": json.dumps(response_body, ensure_ascii=False),
    }


# ── Local Testing ────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  PegelSync — Multi-Station Local Test Run")
    print(f"  Monitoring {len(MONITORED_STATIONS)} station(s)")
    print("=" * 60)

    # Mock S3 for local testing to avoid needing AWS credentials
    import boto3
    class MockS3:
        def put_object(self, *args, **kwargs):
            pass
    boto3.client = lambda *args, **kwargs: MockS3()

    try:
        result = lambda_handler(event={}, context=None)
        print("\n📋 Lambda Response:")
        print(json.dumps(json.loads(result["body"]), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"\n❌ Error during local test: {e}")
