"use client";

import { useState, useEffect } from "react";
import { SyncPayload } from "@/types";
import { S3_STATUS_URL, LOCAL_STATUS_URL, REFRESH_INTERVAL_MS } from "@/lib/constants";

export type ConnectionStatus = "loading" | "live" | "demo" | "error";

async function tryFetch(url: string): Promise<SyncPayload> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as SyncPayload;
}

export function useStationData() {
  const [data, setData] = useState<SyncPayload | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("loading");

  const fetchData = async () => {
    setStatus("loading");
    try {
      // Primary: live S3 feed.
      const json = await tryFetch(S3_STATUS_URL);
      setData(json);
      setStatus("live");
    } catch {
      try {
        // Fallback: bundled sample so the dashboard always renders (dev / offline).
        const sample = await tryFetch(LOCAL_STATUS_URL);
        setData(sample);
        setStatus("demo");
      } catch (err) {
        console.error("[PegelSync] Fetch failed:", err);
        setStatus("error");
      }
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { data, status, refresh: fetchData };
}
