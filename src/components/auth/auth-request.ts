import type { ZodError } from "zod";

// Chamadas das telas de acesso às rotas /api/auth/* e leitura do erro padrão (D7).

export type AuthRequestResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const NETWORK_ERROR = {
  ok: false,
  code: "network",
  message: "Não foi possível conectar. Verifique a internet e tente de novo.",
} as const;

export async function postAuth(path: string, body: unknown): Promise<AuthRequestResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NETWORK_ERROR;
  }
  if (response.ok) return { ok: true };
  try {
    const { error } = (await response.json()) as { error?: { code?: string; message?: string } };
    if (error?.code && error.message) return { ok: false, code: error.code, message: error.message };
  } catch {
    // corpo fora do padrão: cai na mensagem genérica abaixo
  }
  return { ok: false, code: "unexpected", message: "Algo deu errado do nosso lado. Tente de novo em instantes." };
}

// Primeira mensagem do Zod por campo, para mostrar embaixo de cada input.
export function fieldErrorsOf<Field extends string>(error: ZodError): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as Field | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

// Leva o foco ao primeiro campo com erro (na ordem do formulário).
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  form?.querySelector<HTMLInputElement>("[aria-invalid='true']")?.focus();
}
