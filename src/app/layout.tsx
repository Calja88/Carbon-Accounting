import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Paragon ID UK — Carbon Reporting",
  description: "Scope 1, Scope 2 and Scope 3 GHG data entry, calculation and reporting for Paragon ID UK.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full flex flex-col bg-slate-50 font-sans text-slate-900">{children}</body>
    </html>
  );
}
