import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { WorkbenchShell } from "@/components/shell/WorkbenchShell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sosho Studio",
  description: "Local-first AI workflow, memory, model, and audio workbench.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="bg-canvas text-text-primary antialiased">
        <WorkbenchShell>{children}</WorkbenchShell>
      </body>
    </html>
  );
}
