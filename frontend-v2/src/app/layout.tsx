import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#060912" },
    { media: "(prefers-color-scheme: light)", color: "#eef1f8" },
  ],
};

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
