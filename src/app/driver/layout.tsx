import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "../globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reyy EV — Driver",
  description: "Driver home page",
};

// Minimal mobile layout for the driver WebView — no dashboard navigation.
export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${geist.variable} min-h-screen bg-gray-50 text-gray-900 antialiased`}
    >
      {children}
    </div>
  );
}
