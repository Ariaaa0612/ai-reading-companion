import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/layout/BottomNav";
import { Toaster } from "@/components/ui/sonner";
import { AuthGuard } from "@/components/AuthGuard";
import { PostHogInit } from "@/components/PostHogInit";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI 阅读陪伴",
  description: "AI 阅读陪伴应用 —— 在阅读中提升理解力、批判性思维、联想力、表达力与反思力",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-gray-50">
        <PostHogInit />
        <AuthGuard>{children}</AuthGuard>
        <BottomNav />
        <Toaster />
      </body>
    </html>
  );
}
