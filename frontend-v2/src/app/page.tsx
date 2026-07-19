"use client";

import { useState } from "react";
import { useStationData } from "@/hooks/useStationData";
import Header from "@/components/Header/Header";
import StationMap from "@/components/Map/DeckMap";
import TelemetryMatrix from "@/components/Matrix/TelemetryMatrix";
import Footer from "@/components/Footer/Footer";

export default function Home() {
  const { data, status } = useStationData();
  const [activeStationId, setActiveStationId] = useState<string | null>(null);

  const stations = data?.stations || [];
  const loading = status === "loading" && !data;

  return (
    <>
      <Header status={status} data={data} />
      <main id="workspace">
        <StationMap
          data={data}
          activeStationId={activeStationId}
          onStationHover={setActiveStationId}
        />
        <TelemetryMatrix
          stations={stations}
          loading={loading}
          activeStationId={activeStationId}
          onStationHover={setActiveStationId}
        />
      </main>
      <Footer />
    </>
  );
}
