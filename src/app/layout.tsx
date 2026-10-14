import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Run the functions next to the database. Supabase is in eu-west-2
// (London) while Vercel defaults new projects to iad1 (Washington), so
// every query was crossing the Atlantic — and these pages make several
// per render. lhr1 is the same city as the database.
export const preferredRegion = "lhr1";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Household Budget",
  description: "Income-proportional expense splitting for households.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
