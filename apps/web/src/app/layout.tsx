import type { Metadata } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const martian = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Reap Energy Agents · mantenimiento que se paga y se verifica",
  description:
    "Un agente lee el consumo eléctrico de cada máquina, compra el repuesto con Reap Agentic Payments y cierra la orden on-chain solo cuando el consumo vuelve a la normalidad.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${archivo.variable} ${martian.variable} h-full`}>
      <body className="min-h-full bg-surface text-ink">{children}</body>
    </html>
  );
}
