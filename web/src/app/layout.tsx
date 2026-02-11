import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hippocampus",
  description: "Hippocampus v2.0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
