import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "QCEX · Sandbox Exchange",
  icons: {
    icon: [
      { url: "https://quantellics.com/favicon.ico", sizes: "48x48" },
      { url: "https://quantellics.com/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "https://quantellics.com/apple-touch-icon.png",
  },
  description:
    "QCEX development sandbox. Trade synthetic assets in a local exchange.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
