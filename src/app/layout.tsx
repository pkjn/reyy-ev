import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reyy EV",
  description: "Scooty rental management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <nav className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <Link href="/" className="text-xl font-bold text-emerald-600">
              Reyy EV
            </Link>
            <div className="flex gap-6">
              <Link
                href="/"
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Dashboard
              </Link>
              <Link
                href="/customers"
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Customers
              </Link>
              <Link
                href="/leads"
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Leads
              </Link>
              <Link
                href="/rentals"
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Rentals
              </Link>
              <Link
                href="/accounts"
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Accounts
              </Link>
            </div>
          </div>
        </nav>
        <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
