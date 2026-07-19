"use client";

import { useState } from "react";
import { useStationData } from "@/hooks/useStationData";
import Header from "@/components/Header/Header";
import StationMap from "@/components/Map/DeckMap";
import TelemetryMatrix from "@/components/Matrix/TelemetryMatrix";
import StationDrawer from "@/components/StationDrawer/StationDrawer";
import Footer from "@/components/Footer/Footer";

export default function Home() {
  const { data, status } = useStationData();
  const [activeStationId, setActiveStationId] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

  const stations = data?.stations || [];
  const loading = status === "loading" && !data;
  const selectedStation = stations.find((s) => s.station_id === selectedStationId) || null;

  return (
    <div id="app-shell">
      <Header status={status} data={data} />
      <main id="workspace">
        <StationMap
          data={data}
          activeStationId={activeStationId}
          selectedStationId={selectedStationId}
          onStationHover={setActiveStationId}
          onStationClick={setSelectedStationId}
        />
        <TelemetryMatrix
          stations={stations}
          loading={loading}
          activeStationId={activeStationId}
          selectedStationId={selectedStationId}
          onStationHover={setActiveStationId}
          onStationClick={setSelectedStationId}
        />
      </main>
      <Footer />
      <StationDrawer station={selectedStation} onClose={() => setSelectedStationId(null)} />
    </div>
  );
}
