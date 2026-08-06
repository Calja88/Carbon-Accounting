import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paragon ID UK — Carbon Reporting",
  description: "Scope 1 and Scope 2 GHG data entry, calculation and reporting for Paragon ID UK.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50">{children}</body>
    </html>
  );
}
