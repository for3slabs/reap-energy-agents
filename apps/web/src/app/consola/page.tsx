import type { Metadata } from "next";
import { ClientConsole } from "@/components/client-console";

export const metadata: Metadata = {
  title: "Consola · Reap Energy Agents",
};

export default function ConsolaPage() {
  return <ClientConsole />;
}
