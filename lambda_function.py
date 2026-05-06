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
from datetime import datetime, timezone
import urllib.request
import urllib.error

# We use quote to safely URL-encode German umlauts (e.g. KÖLN -> K%C3%96LN)
from urllib.parse import quote
import boto3


# ── Configuration ────────────────────────────────────────────────────────

# The base URL for Germany's PEGELONLINE REST API (v2) — this is the modern
# version of the free, public service that provides real-time water-level
# data for rivers across Germany.  The legacy "rest2009" endpoint is
# deprecated and returns 404 for many stations.
PEGELONLINE_BASE_URL = "https://www.pegelonline.wsv.de/webservices/rest-api/v2"

# List of target stations and their respective flood thresholds in metres.
MONITORED_STATIONS = [
    {
        "station_id": "KÖLN",           # PEGELONLINE station identifier
        "label": "Cologne (Rhine)",      # Human-readable name
        "threshold_m": 6.20,             # Flood threshold in metres
    },
    {
        "station_id": "PASSAU DONAU",     # PEGELONLINE station identifier
        "label": "Passau (Danube)",       # Human-readable name
        "threshold_m": 7.00,             # Flood threshold in metres
    },
    {
        "station_id": "DRESDEN",         # PEGELONLINE station identifier
        "label": "Dresden (Elbe)",        # Human-readable name
        "threshold_m": 4.00,             # Flood threshold in metres
    },
]

S3_BUCKET_NAME = os.environ.get("ALERT_BUCKET_NAME", "aryan-hydro-alerts-882611-2026")


# ── Helper Functions ─────────────────────────────────────────────────────

def fetch_current_water_level(station_id: str) -> dict:
    """
    Call the PEGELONLINE API and return a dictionary with the station name,
    the current water level (in metres), and the timestamp of the reading.

    Parameters
    ----------
    station_id : str
        The human-readable name of the gauging station (e.g. "KÖLN").

    Returns
    -------
    dict
        {
            "station": str,       – station name
            "water_level_m": float, – water level converted to metres
            "timestamp": str,     – ISO-format timestamp of the measurement
            "unit": str           – original unit reported by the API
        }
    """

    # Build the full URL to fetch the current measurement for our station.
    # The `includeCurrentMeasurement=true` query parameter tells the API
    # to attach the latest reading to its response.
    #
    # We use `quote(station_id, safe="")` to URL-encode the station name.
    # This converts characters that are not safe in URLs:
    #   "KÖLN"         → "K%C3%96LN"       (umlaut Ö → %C3%96)
    #   "PASSAU DONAU" → "PASSAU%20DONAU"  (space → %20)
    # Without encoding, the API would return a 404 error for these names.
    encoded_name = quote(station_id, safe="")
    url = f"{PEGELONLINE_BASE_URL}/stations/{encoded_name}/W.json?includeCurrentMeasurement=true"

    with urllib.request.urlopen(url, timeout=10) as response:
        raw_bytes = response.read()
        data = json.loads(raw_bytes.decode("utf-8"))

    # The v2 API timeseries endpoint returns measurement data (unit, value,
    # timestamp) but NOT the station's human-readable name — that lives on
    # the station endpoint.  So we use the station_id we already have as
    # the fallback name.
    current_measurement = data.get("currentMeasurement", {})

    # Extract the numeric water-level value from the measurement.
    raw_value = current_measurement.get("value", 0)

    # The unit reported by PEGELONLINE is typically "cm" (centimetres).
    unit = data.get("unit", "cm")

    # Convert the raw value to metres if the unit is centimetres.
    if unit == "cm":
        water_level_m = raw_value / 100.0  # 500 cm → 5.0 m
    else:
        water_level_m = raw_value  # already in metres (unlikely but safe)

    # Extract the ISO-format timestamp string of when the reading was taken.
    timestamp = current_measurement.get("timestamp", "unknown")

    # The v2 timeseries endpoint does not include the station's longname,
    # so we fallback to using the requested station_id.
    return {
        "station": station_id,
        "water_level_m": water_level_m,
        "timestamp": timestamp,
        "unit": unit,
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

    # ── Step 1: Loop through every monitored station ─────────────────
    for station_config in MONITORED_STATIONS:

        station_id = station_config["station_id"]
        label      = station_config["label"]
        threshold  = station_config["threshold_m"]

        print(f"📡 [{label}] Fetching water level for station: {station_id} …")

        # Catch individual station failures to prevent the entire invocation from failing
        try:
            station_data = fetch_current_water_level(station_id)
        except Exception as exc:
            print(f"   ❌ Failed to fetch data for {label}: {exc}")

            all_stations_status.append({
                "label": label,
                "station_id": station_id,
                "water_level_m": None,
                "threshold_m": threshold,
                "measurement_timestamp": None,
                "status": "ERROR",
                "message": str(exc),
            })
            continue

        print(
            f"   Station   : {station_data['station']}\n"
            f"   Level     : {station_data['water_level_m']:.2f} m\n"
            f"   Threshold : {threshold:.2f} m\n"
            f"   Time      : {station_data['timestamp']}"
        )

        # ── Step 2: Check against this station's threshold ───────────
        is_alert = station_data["water_level_m"] > threshold

        if is_alert:
            print(f"   🚨 Threshold exceeded at {label}! Generating alert …")
            alert_payload = build_alert_payload(station_data, threshold)
            alerts_list.append(alert_payload)
        else:
            print(f"   ✅ {label} is within safe limits.")

        all_stations_status.append({
            "label": label,
            "station_id": station_id,
            "water_level_m": station_data["water_level_m"],
            "threshold_m": threshold,
            "measurement_timestamp": station_data["timestamp"],
            "status": "ALERT" if is_alert else "SAFE",
        })

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
    print("  SerHydroSys — Multi-Station Local Test Run")
    print(f"  Monitoring {len(MONITORED_STATIONS)} station(s)")
    print("=" * 60)

    try:
        result = lambda_handler(event={}, context=None)
        print("\n📋 Lambda Response:")
        print(json.dumps(json.loads(result["body"]), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"\n❌ Error during local test: {e}")
