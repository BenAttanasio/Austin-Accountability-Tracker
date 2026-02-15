import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Austin Accountability Tracker",
  description: "Public accountability tool monitoring Austin, TX city government spending using open data APIs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
