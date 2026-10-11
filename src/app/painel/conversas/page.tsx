import type { Metadata } from "next";
import { ConversationsScreen } from "@/components/painel/conversas/conversations-screen";

export const metadata: Metadata = { title: "Conversas · Slotz" };

export default function ConversasPage() {
  return <ConversationsScreen />;
}
