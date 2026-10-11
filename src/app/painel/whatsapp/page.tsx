import type { Metadata } from "next";
import { WhatsAppScreen } from "@/components/painel/whatsapp/whatsapp-screen";

export const metadata: Metadata = { title: "WhatsApp · Slotz" };

export default function WhatsAppPage() {
  return <WhatsAppScreen />;
}
