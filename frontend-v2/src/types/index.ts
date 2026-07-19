export interface Station {
  station_id: string;
  label: string;
  lat: number;
  lon: number;
  status: "SAFE" | "ALERT" | "ERROR";
  water_level_m: number | null;
  threshold_m: number;
  rate_of_change_cm_hr: number | null;
  discharge_m3s: number | null;
  trend: "rising" | "falling" | "stable";
  precip_next_24h_mm: number;
  precip_next_48h_mm: number;
  precip_condition: "heavy" | "moderate" | "light" | "dry";
  measurement_timestamp: string | null;
  // ── Phase 5: forecast (level in metres + 90% prediction interval) ──
  forecast_ok: boolean;
  forecast_skill: boolean;
  forecast_source: "efas" | "local";
  forecast_phi: number | null;
  forecast_drift_m_per_h: number | null;
  forecast_6h_m: number | null;
  forecast_12h_m: number | null;
  forecast_24h_m: number | null;
  forecast_48h_m: number | null;
  forecast_6h_lower_m: number | null;
  forecast_6h_upper_m: number | null;
  forecast_24h_lower_m: number | null;
  forecast_24h_upper_m: number | null;
  forecast_n: number;
}

export interface SyncPayload {
  generated_at: string;
  stations: Station[];
}
