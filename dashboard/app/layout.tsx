import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis — Hardware-Rooted Payment Guardian",
  description:
    "Live policy, allowlist and audit view for the Aegis autonomous-payment agent on Casper testnet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
