import type { Metadata } from "next";
import { ProfessionalsScreen } from "@/components/painel/catalog/professionals-screen";

export const metadata: Metadata = { title: "Profissionais · Slotz" };

export default function ProfissionaisPage() {
  return <ProfessionalsScreen />;
}
