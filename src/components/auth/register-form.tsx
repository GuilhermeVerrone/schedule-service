"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PANEL_PATH, LOGIN_PATH } from "@/server/auth/redirects";
import { PASSWORD_MIN_LENGTH, registerSchema } from "@/server/validation/auth";
import { fieldErrorsOf, focusFirstInvalid, postAuth } from "./auth-request";
import { Field } from "./field";
import { FormAlert } from "./form-alert";
import { SubmitButton } from "./submit-button";

type RegisterField = "businessName" | "email" | "password";

// Cadastro do dono (guia 7a): cria tenant + conta e entra logado no painel.
export function RegisterForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<RegisterField, string>>>({});
  const [alert, setAlert] = useState<string | null>(null);

  function clearError(field: RegisterField) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const data = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      businessName: data.get("businessName"),
      email: data.get("email"),
      password: data.get("password"),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsOf<RegisterField>(parsed.error));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }

    setErrors({});
    setPending(true);
    const result = await postAuth("/api/auth/register", parsed.data);
    if (result.ok) {
      toast.success("Conta criada", { description: "Agora cadastre seus serviços e sua equipe." });
      router.replace(PANEL_PATH);
      return;
    }

    setPending(false);
    if (result.code === "email_in_use") setErrors({ email: result.message });
    else if (result.code === "weak_password") setErrors({ password: result.message });
    else if (result.code === "network") toast.error(result.message);
    else setAlert(result.message);
    requestAnimationFrame(() => focusFirstInvalid(formRef.current));
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <Field
        name="businessName"
        label="Nome do negócio"
        hint="Como seus clientes conhecem o seu negócio."
        autoComplete="organization"
        maxLength={80}
        error={errors.businessName}
        onChange={() => clearError("businessName")}
      />
      <Field
        name="email"
        label="E-mail"
        type="email"
        inputMode="email"
        autoComplete="email"
        spellCheck={false}
        error={errors.email}
        onChange={() => clearError("email")}
      />
      <Field
        name="password"
        label="Senha"
        type="password"
        hint={`Pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`}
        autoComplete="new-password"
        error={errors.password}
        onChange={() => clearError("password")}
      />
      {alert && <FormAlert message={alert} />}
      <SubmitButton pending={pending} label="Criar minha conta" pendingLabel="Criando sua conta…" />
      <p className="text-center text-small text-ink-2">
        Já tem conta? <Link href={LOGIN_PATH}>Entrar</Link>
      </p>
    </form>
  );
}
