import type { Metadata } from "next";
import { TemplatesScreen } from "@/components/painel/messages/templates-screen";

export const metadata: Metadata = { title: "Mensagens · Slotz" };

export default function MensagensPage() {
  return <TemplatesScreen />;
}
