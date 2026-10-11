// Opt-out por mensagem (guia 6, 7c; D4). Vale só a mensagem inteira, sem diferenciar maiúscula,
// acento ou espaço: "Sair", " sair ", "SAÍR" contam; "quero sair" ou "sair da lista" não. `VOLTAR`
// reativa. Função pura: o efeito (marcar `opt_out`) é do repositório do webhook.

export const OPT_OUT_WORDS = ["SAIR", "PARAR", "CANCELAR", "STOP"] as const;
export const OPT_IN_WORDS = ["VOLTAR"] as const;

export type OptOutCommand = "opt_out" | "opt_in";

// Sem acentos (marcas combinantes), sem espaços nem caracteres invisíveis, em maiúsculas.
export function normalizeCommandText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s\p{Cf}]/gu, "")
    .toUpperCase();
}

export function parseOptOutCommand(text: string | null): OptOutCommand | null {
  if (!text) return null;
  const word = normalizeCommandText(text);
  if ((OPT_OUT_WORDS as readonly string[]).includes(word)) return "opt_out";
  if ((OPT_IN_WORDS as readonly string[]).includes(word)) return "opt_in";
  return null;
}

// Uma confirmação por contato (D15: marcada para nunca repetir). A mesma chave em qualquer
// reenvio faz o `enqueueMessage` devolver `duplicate`.
export const optOutConfirmationKey = (contactId: string): string => `optout_confirmation:${contactId}`;
