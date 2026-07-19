import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "PegelSync — Live River Telemetry & Forecast Network",
  description:
    "Serverless hydrological flood-risk monitoring across Germany's 5 major river basins. Real-time levels, discharge, precipitation and backtest-validated forecasts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
