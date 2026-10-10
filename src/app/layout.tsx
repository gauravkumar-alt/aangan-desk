import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Aangan Front Desk",
  description: "AI phone front desk for Aangan Studio: every call answered, qualified enquiries handed to designers with context.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans text-[14px]">{children}</body>
    </html>
  );
}
