import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Criar conta · Slotz" };

// /cadastro (guia 7a). Com sessão, o proxy manda direto para o painel.
export default function RegisterPage() {
  return (
    <AuthShell
      title="Crie a conta do seu negócio"
      lead="Leva um minuto. Depois você deixa pronto o que seus clientes vão ver na hora de agendar."
      formTitle="Seus dados de acesso"
      aside={{ href: "/login", label: "Entrar" }}
      points={[
        { numeral: "01", text: "Seus serviços, com duração e preço." },
        { numeral: "02", text: "Sua equipe e o que cada pessoa atende." },
        { numeral: "03", text: "Os horários de atendimento de cada profissional." },
      ]}
    >
      <RegisterForm />
    </AuthShell>
  );
}
