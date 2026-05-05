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
from urllib.parse import quote
import boto3


# ── Configuration ────────────────────────────────────────────────────────

PEGELONLINE_BASE_URL = "https://www.pegelonline.wsv.de/webservices/rest-api/v2"

MONITORED_STATIONS = [
    {"station_id": "KÖLN",         "label": "Cologne (Rhine)",  "threshold_m": 6.20},
    {"station_id": "PASSAU DONAU", "label": "Passau (Danube)",   "threshold_m": 7.00},
    {"station_id": "DRESDEN",      "label": "Dresden (Elbe)",    "threshold_m": 4.00},
]

S3_BUCKET_NAME = os.environ.get("ALERT_BUCKET_NAME", "aryan-hydro-alerts-882611-2026")


# ── Helper Functions ─────────────────────────────────────────────────────

def fetch_current_water_level(station_id: str) -> dict:
    encoded_name = quote(station_id, safe="")
    url = f"{PEGELONLINE_BASE_URL}/stations/{encoded_name}/W.json?includeCurrentMeasurement=true"
    with urllib.request.urlopen(url, timeout=10) as response:
        raw_bytes = response.read()
        data = json.loads(raw_bytes.decode("utf-8"))
    current_measurement = data.get("currentMeasurement", {})
    raw_value = current_measurement.get("value", 0)
    unit = data.get("unit", "cm")
    water_level_m = raw_value / 100.0 if unit == "cm" else raw_value
    timestamp = current_measurement.get("timestamp", "unknown")
    return {"station": station_id, "water_level_m": water_level_m, "timestamp": timestamp, "unit": unit}


def build_alert_payload(station_data: dict, threshold: float) -> dict:
    message = (
        f"⚠️ FLOOD ALERT: Water level at {station_data['station']} is "
        f"{station_data['water_level_m']:.2f} m, exceeding the threshold "
        f"of {threshold:.2f} m."
    )
    return {
        "alert_type": "FLOOD_WARNING",
        "station": station_data["station"],
        "water_level_m": station_data["water_level_m"],
        "threshold_m": threshold,
        "measurement_timestamp": station_data["timestamp"],
        "alert_generated_at": datetime.now(timezone.utc).isoformat(),
        "message": message,
    }


def save_alerts_to_s3(alerts_list: list, bucket_name: str) -> str:
    s3_client = boto3.client("s3")
    timestamp_slug = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    object_key = f"alerts/{timestamp_slug}.json"
    combined_payload = {
        "alert_batch_generated_at": datetime.now(timezone.utc).isoformat(),
        "total_alerts": len(alerts_list),
        "alerts": alerts_list,
    }
    body = json.dumps(combined_payload, indent=2, ensure_ascii=False)
    s3_client.put_object(Bucket=bucket_name, Key=object_key, Body=body, ContentType="application/json")
    return object_key


def save_latest_status_to_s3(stations_status: list, bucket_name: str) -> str:
    s3_client = boto3.client("s3")
    object_key = "latest_status.json"
    status_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stations_checked": len(stations_status),
        "stations": stations_status,
    }
    body = json.dumps(status_payload, indent=2, ensure_ascii=False)
    s3_client.put_object(Bucket=bucket_name, Key=object_key, Body=body, ContentType="application/json", CacheControl="max-age=300")
    return object_key


# ── Lambda Handler ───────────────────────────────────────────────────────

def lambda_handler(event, context):
    alerts_list = []
    all_stations_status = []

    for station_config in MONITORED_STATIONS:
        station_id = station_config["station_id"]
        label      = station_config["label"]
        threshold  = station_config["threshold_m"]
        print(f"📡 [{label}] Fetching water level for station: {station_id} …")
        try:
            station_data = fetch_current_water_level(station_id)
        except Exception as exc:
            print(f"   ❌ Failed to fetch data for {label}: {exc}")
            all_stations_status.append({"label": label, "station_id": station_id, "water_level_m": None, "threshold_m": threshold, "measurement_timestamp": None, "status": "ERROR", "message": str(exc)})
            continue
        print(f"   Station   : {station_data['station']}\n   Level     : {station_data['water_level_m']:.2f} m\n   Threshold : {threshold:.2f} m\n   Time      : {station_data['timestamp']}")
        is_alert = station_data["water_level_m"] > threshold
        if is_alert:
            print(f"   🚨 Threshold exceeded at {label}! Generating alert …")
            alerts_list.append(build_alert_payload(station_data, threshold))
        else:
            print(f"   ✅ {label} is within safe limits.")
        all_stations_status.append({"label": label, "station_id": station_id, "water_level_m": station_data["water_level_m"], "threshold_m": threshold, "measurement_timestamp": station_data["timestamp"], "status": "ALERT" if is_alert else "SAFE"})

    alert_s3_key = None
    if alerts_list:
        print(f"\n💾 {len(alerts_list)} alert(s) generated. Saving to S3 bucket: {S3_BUCKET_NAME} …")
        alert_s3_key = save_alerts_to_s3(alerts_list, S3_BUCKET_NAME)
        print(f"✅ Alerts saved to s3://{S3_BUCKET_NAME}/{alert_s3_key}")
    else:
        print("\n✅ All stations are within safe limits. No alert file created.")

    print(f"📊 Saving latest_status.json to s3://{S3_BUCKET_NAME}/ …")
    status_key = save_latest_status_to_s3(all_stations_status, S3_BUCKET_NAME)
    print(f"✅ Dashboard data saved to s3://{S3_BUCKET_NAME}/{status_key}")

    response_body = {"result": "ALERTS_CREATED" if alerts_list else "NO_ALERTS", "stations_checked": len(MONITORED_STATIONS), "total_alerts": len(alerts_list), "status_s3_key": status_key}
    if alert_s3_key:
        response_body["alert_s3_key"] = alert_s3_key
    return {"statusCode": 200, "body": json.dumps(response_body, ensure_ascii=False)}


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
