import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = { title: "AI Workforce Search", description: "AI-powered prospecting, recruitment relationships, and career discovery." };
export default function RootLayout({ children }: Readonly<{children: ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
