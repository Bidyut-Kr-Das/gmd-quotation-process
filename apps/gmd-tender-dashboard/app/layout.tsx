import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/NavBar";
import StoreProvider from "@/lib/store-provider";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import { DataLoader } from "@/components/DataLoader";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tender Executive Dashboard",
  description:
    "Executive dashboard for monitoring tender participation and supply history",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-touch-icon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon-16x16.png"
        />
        <link rel="manifest" href="/site.webmanifest"></link>
      </head>
      <body className="min-h-full flex flex-col">
        <SessionProviderWrapper>
          <NavBar />
          <div
            style={{
              paddingTop: "42px",
              height: "100vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <StoreProvider><DataLoader>{children}</DataLoader></StoreProvider>
            <Toaster richColors />
          </div>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
