"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LOGGED_OUT_PARAM, REGISTER_PATH, safeNextPath } from "@/server/auth/redirects";
import { loginSchema } from "@/server/validation/auth";
import { fieldErrorsOf, focusFirstInvalid, postAuth } from "./auth-request";
import { Field } from "./field";
import { FormAlert } from "./form-alert";
import { SubmitButton } from "./submit-button";

type LoginField = "email" | "password";

// Login do dono (guia 7b). Erro de credencial é genérico (premissa e) e aparece no alerta do
// formulário, não num campo. Depois de entrar, volta para o ?next= do painel, se houver.
export function LoginForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<LoginField, string>>>({});
  const [alert, setAlert] = useState<string | null>(null);

  // Vindo do "Sair": confirma com um toast e tira a marca da URL (lido no cliente para a página
  // continuar estática).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(LOGGED_OUT_PARAM) !== "1") return;
    toast.success("Você saiu da conta.", { id: "saiu" });
    url.searchParams.delete(LOGGED_OUT_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }, []);

  function clearError(field: LoginField) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAlert(null);
    const data = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({ email: data.get("email"), password: data.get("password") });
    if (!parsed.success) {
      setErrors(fieldErrorsOf<LoginField>(parsed.error));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }

    setErrors({});
    setPending(true);
    const result = await postAuth("/api/auth/login", parsed.data);
    if (result.ok) {
      // Lido no envio (e não com useSearchParams) para a página continuar estática.
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
      return;
    }

    setPending(false);
    if (result.code === "network") toast.error(result.message);
    else setAlert(result.message);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
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
        autoComplete="current-password"
        error={errors.password}
        onChange={() => clearError("password")}
      />
      {alert && <FormAlert message={alert} />}
      <SubmitButton pending={pending} label="Entrar" pendingLabel="Entrando…" />
      <p className="text-center text-small text-ink-2">
        Ainda não tem conta? <Link href={REGISTER_PATH}>Criar minha conta</Link>
      </p>
    </form>
  );
}
