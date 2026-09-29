import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Screen & Refer",
  description: "Community health screening and doctor referral",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f766e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <Nav />
          <main className="container">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
