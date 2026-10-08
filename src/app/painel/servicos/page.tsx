import type { Metadata } from "next";
import { ServicesScreen } from "@/components/painel/catalog/services-screen";

export const metadata: Metadata = { title: "Serviços · Slotz" };

export default function ServicosPage() {
  return <ServicesScreen />;
}
