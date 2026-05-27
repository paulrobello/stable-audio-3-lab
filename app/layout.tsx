import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pardora Lab",
  description: "Local Next.js test rig for Stable Audio 3 music and sound effects generation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
