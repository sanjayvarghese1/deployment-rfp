import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import Navbar from "@/components/Navbar";
import BackgroundGenerationSubscriber from "@/components/BackgroundGenerationSubscriber";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ProcureNet",
  description: "Professional procurement network for companies and vendors",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased min-h-screen`} style={{ background: "var(--background)" }}>
        <AuthProvider>
          <BackgroundGenerationSubscriber />
          <Navbar />
          <main className="pt-2">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}

