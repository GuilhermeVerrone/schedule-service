import type { Metadata } from "next";
import { AgendaScreen } from "@/components/painel/agenda/agenda-screen";

export const metadata: Metadata = { title: "Agenda · Slotz" };

export default function AgendaPage() {
  return <AgendaScreen />;
}
