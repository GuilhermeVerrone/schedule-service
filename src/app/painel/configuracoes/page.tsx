import type { Metadata } from "next";
import { SettingsScreen } from "@/components/painel/settings/settings-screen";

export const metadata: Metadata = { title: "Configurações · Slotz" };

export default function ConfiguracoesPage() {
  return <SettingsScreen />;
}
