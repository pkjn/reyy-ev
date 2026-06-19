"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navbar() {
  const pathname = usePathname();

  // Hide the navbar on driver app pages and login pages
  if (pathname.startsWith("/driver") || pathname.startsWith("/login")) {
    return null;
  }

  return (
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
  );
}
