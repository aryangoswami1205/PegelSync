import { SyncPayload } from "@/types";

export function exportReport(data: SyncPayload | null) {
  if (!data || !data.stations) {
    alert("No telemetry data loaded. Please wait for the feed to sync.");
    return;
  }

  const { stations, generated_at } = data;
  const generatedAt = generated_at || new Date().toISOString();

  const headers = [
    "Report Timestamp",
    "Station",
    "Station ID",
    "River",
    "Latitude",
    "Longitude",
    "Current Level (m)",
    "Trend",
    "Discharge (m3/s)",
    "Precip 24h (mm)",
    "Threshold (m)",
    "Level %",
    "Status",
    "Measurement Timestamp",
  ];

  const rows = stations.map((s) => {
    const riverMatch = s.label.match(/\(([^)]+)\)/);
    const river = riverMatch ? riverMatch[1] : "—";
    const level = s.water_level_m != null ? s.water_level_m.toFixed(2) : "N/A";
    const threshold = s.threshold_m.toFixed(2);
    const pct = s.water_level_m != null
        ? ((s.water_level_m / s.threshold_m) * 100).toFixed(1) + "%"
        : "N/A";

    return [
      generatedAt,
      `"${s.label}"`,
      s.station_id,
      river,
      s.lat ?? "",
      s.lon ?? "",
      level,
      s.trend || "stable",
      s.discharge_m3s != null ? s.discharge_m3s : "",
      s.precip_next_24h_mm != null ? s.precip_next_24h_mm : "",
      threshold,
      pct,
      s.status,
      s.measurement_timestamp || "N/A",
    ].join(",");
  });

  const csvContent = [headers.join(","), ...rows].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

  link.href = url;
  link.download = `PegelSync_Report_${slug}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
