import type { Metadata } from "next";
import { Libre_Baskerville, Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  variable: "--font-brand",
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Matcha Missionary — Pop-Up Ops",
  description: "Internal ops tool for matcha pop-up events.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${montserrat.variable} ${libreBaskerville.variable}`}>
      <body className="bg-cream-50 text-matcha-900 font-sans">{children}</body>
    </html>
  );
}
