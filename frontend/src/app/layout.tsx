import type { Metadata } from "next";
import localFont from "next/font/local";

import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

// Loaded from disk, not next/font/google: that fetches from fonts.gstatic.com
// during the build, and the Docker build has no way out to it.
const geistSans = localFont({
  src: "./fonts/Geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VAD from Scratch",
  description: "Voice activity detection, built from scratch.",
};

// Runs while the head is parsed, so the palette is settled before anything is
// painted. An effect would be a frame too late and you would see the flash.
const applyTheme = `(function(){try{var t=localStorage.getItem("theme");if(!t){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyTheme }} />
      </head>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
