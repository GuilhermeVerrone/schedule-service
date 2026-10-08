import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar · Slotz" };

// /login (guia 7b). Com sessão, o proxy manda direto para o painel.
export default function LoginPage() {
  return (
    <AuthShell
      title="Entre no seu painel"
      lead="Serviços, equipe e horários do seu negócio num lugar só."
      formTitle="Acesse sua conta"
      aside={{ href: "/cadastro", label: "Criar minha conta" }}
    >
      <LoginForm />
    </AuthShell>
  );
}
