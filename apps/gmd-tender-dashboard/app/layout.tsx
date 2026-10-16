import type { Metadata } from "next";
import { Poppins, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/NavBar";
import StoreProvider from "@/lib/store-provider";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import { DataLoader } from "@/components/DataLoader";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
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
      className={`${poppins.variable} ${geistMono.variable} h-screen overflow-hidden antialiased`}
      suppressHydrationWarning
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
        {/* Icon font used by the shared @gmd/dashboard / contract-review components */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block"
        />
      </head>
      <body className="flex h-screen flex-col overflow-hidden bg-background">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          storageKey="gmd-theme"
          disableTransitionOnChange
        >
          <SessionProviderWrapper>
            <NavBar />
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              <StoreProvider><DataLoader>{children}</DataLoader></StoreProvider>
            </div>
            <Toaster position="top-right" richColors />
          </SessionProviderWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
