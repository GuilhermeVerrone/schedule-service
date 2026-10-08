import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Fontes da marca Algoritmi, self-hosted (OFL em src/app/fonts).
const manrope = localFont({
  src: [
    { path: "./fonts/manrope-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/manrope-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/manrope-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-manrope",
  display: "swap",
});

const poppins = localFont({
  src: [{ path: "./fonts/poppins-600.woff2", weight: "600", style: "normal" }],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Slotz",
  description: "Atendimento, agenda e cobrança no WhatsApp para pequenos negócios.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${manrope.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
