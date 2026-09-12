"use client";

import { useState, useEffect, useCallback } from "react";
import { SyncPayload } from "@/types";
import { S3_STATUS_URL, REFRESH_INTERVAL_MS } from "@/lib/constants";
import { DEFAULT_STATUS } from "@/lib/defaultStatus";

export type ConnectionStatus = "live" | "demo";

async function fetchLive(): Promise<SyncPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(S3_STATUS_URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as SyncPayload;
  } finally {
    clearTimeout(timer);
  }
}

export function useStationData() {
  // Render immediately from the embedded snapshot so the dashboard always
  // shows data — even offline, on restricted networks, or before the live
  // feed resolves. The live S3 feed is layered on top when reachable.
  const [data, setData] = useState<SyncPayload>(DEFAULT_STATUS);
  const [status, setStatus] = useState<ConnectionStatus>("demo");

  const refresh = useCallback(async () => {
    try {
      const json = await fetchLive();
      setData(json);
      setStatus("live");
    } catch {
      setData(DEFAULT_STATUS);
      setStatus("demo");
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const json = await fetchLive();
        if (active) {
          setData(json);
          setStatus("live");
        }
      } catch {
        if (active) {
          setData(DEFAULT_STATUS);
          setStatus("demo");
        }
      }
    }

    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return { data, status, refresh };
}
