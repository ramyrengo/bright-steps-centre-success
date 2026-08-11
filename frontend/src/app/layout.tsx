import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Bright Steps Centre Success",
  description: "Bright Steps Centre Success foundation environment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
