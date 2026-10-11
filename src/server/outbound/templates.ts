import { OUTBOUND_MESSAGE_TYPES, type OutboundMessageType } from "./message-types";

// Templates de mensagem (guia 5; D5, D16): por tipo da lista fechada, 3 ou mais variações de texto
// puro com variáveis `{{nome}}`. Aqui fica a parte pura (variáveis, textos padrão, validação,
// montagem e escolha da variação); o banco fica em repositories/tenant/message-templates.ts.

// Variáveis aceitas por tipo. O texto montado é sempre texto puro (nunca HTML no WhatsApp).
export const TEMPLATE_VARIABLES = {
  appointment_confirmation: ["nome", "negocio", "servico", "profissional", "data", "hora"],
  optout_confirmation: ["nome", "negocio"],
} as const satisfies Record<OutboundMessageType, readonly string[]>;

export type TemplateVariable<T extends OutboundMessageType> = (typeof TEMPLATE_VARIABLES)[T][number];
export type TemplateVariables<T extends OutboundMessageType> = Record<TemplateVariable<T>, string>;

// Textos padrão: criam o template de cada tenant novo (e dos existentes) e servem para restaurar.
export const DEFAULT_TEMPLATES: Record<OutboundMessageType, readonly string[]> = {
  appointment_confirmation: [
    "Olá, {{nome}}! Seu horário de {{servico}} com {{profissional}} está confirmado para {{data}} às {{hora}}. Até lá! {{negocio}}",
    "{{nome}}, tudo certo! Confirmamos {{servico}} em {{data}}, às {{hora}}, com {{profissional}}. {{negocio}}",
    "Oi, {{nome}}! Agendamento confirmado: {{servico}}, {{data}} às {{hora}}, com {{profissional}}. Te esperamos! {{negocio}}",
  ],
  optout_confirmation: [
    "Pronto, {{nome}}. Você não vai mais receber mensagens automáticas de {{negocio}}. Se mudar de ideia, é só responder VOLTAR.",
    "Combinado, {{nome}}: paramos as mensagens automáticas de {{negocio}}. Para voltar a receber, responda VOLTAR.",
    "Tudo certo, {{nome}}. {{negocio}} não vai mais te enviar mensagens automáticas. Quer receber de novo? Responda VOLTAR.",
  ],
};

export const MIN_VARIATIONS = 3;
export const MAX_VARIATIONS = 10;
export const MAX_VARIATION_LENGTH = 1000;

export class UnknownMessageTypeError extends Error {
  constructor(readonly messageType: unknown) {
    super("Tipo de mensagem fora da lista fechada");
    this.name = "UnknownMessageTypeError";
  }
}

export const isMessageType = (value: unknown): value is OutboundMessageType =>
  typeof value === "string" && (OUTBOUND_MESSAGE_TYPES as readonly string[]).includes(value);

export function assertMessageType(value: unknown): asserts value is OutboundMessageType {
  if (!isMessageType(value)) throw new UnknownMessageTypeError(value);
}

// `index` é a posição da variação; ausente nos problemas da lista inteira.
export type TemplateIssue =
  | { code: "too_few" | "too_many" }
  | { code: "empty" | "too_long" | "duplicate" | "malformed_variable"; index: number }
  | { code: "unknown_variable"; index: number; variable: string };

export class TemplateValidationError extends Error {
  constructor(readonly issues: TemplateIssue[]) {
    super("Template inválido");
    this.name = "TemplateValidationError";
  }
}

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

function variationIssues(type: OutboundMessageType, text: string, index: number): TemplateIssue[] {
  if (text.trim() === "") return [{ code: "empty", index }];
  const issues: TemplateIssue[] = [];
  if (text.length > MAX_VARIATION_LENGTH) issues.push({ code: "too_long", index });
  const allowed: readonly string[] = TEMPLATE_VARIABLES[type];
  for (const [, variable] of text.matchAll(PLACEHOLDER)) {
    if (!allowed.includes(variable)) issues.push({ code: "unknown_variable", index, variable });
  }
  // Chave solta depois de tirar as variáveis bem formadas: `{{nome`, `nome}}`, `{{}}` aninhado.
  if (/\{\{|\}\}/.test(text.replace(PLACEHOLDER, ""))) issues.push({ code: "malformed_variable", index });
  return issues;
}

// Lista vazia = válido. Compara as variações sem os espaços das pontas (é assim que são gravadas).
export function validateVariations(type: unknown, variations: readonly string[]): TemplateIssue[] {
  assertMessageType(type);
  const issues: TemplateIssue[] = [];
  if (variations.length < MIN_VARIATIONS) issues.push({ code: "too_few" });
  if (variations.length > MAX_VARIATIONS) issues.push({ code: "too_many" });
  const seen = new Set<string>();
  variations.forEach((text, index) => {
    issues.push(...variationIssues(type, text, index));
    const key = text.trim();
    if (key !== "" && seen.has(key)) issues.push({ code: "duplicate", index });
    seen.add(key);
  });
  return issues;
}

// Valida e devolve as variações prontas para gravar; inválido lança TemplateValidationError.
export function normalizeVariations(type: unknown, variations: readonly string[]): string[] {
  const issues = validateVariations(type, variations);
  if (issues.length > 0) throw new TemplateValidationError(issues);
  return variations.map((text) => text.trim());
}

// Monta o texto final. As variáveis já foram validadas na gravação; o valor entra literal.
export function renderTemplate<T extends OutboundMessageType>(
  text: string,
  values: TemplateVariables<T>,
): string {
  const lookup = values as Record<string, string>;
  return text.replace(PLACEHOLDER, (match, variable: string) =>
    Object.hasOwn(lookup, variable) ? lookup[variable] : match,
  );
}

// Escolha ao acaso sem repetir a última variação usada para o contato (D5). Com uma só variação,
// ou sem histórico válido (nunca enviou, ou o dono encurtou a lista), sorteia entre todas.
export function pickVariation(count: number, lastIndex: number | null, random: () => number = Math.random): number {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("Template sem variações");
  const draw = (size: number) => Math.min(Math.floor(random() * size), size - 1);
  const hasLast = lastIndex !== null && Number.isInteger(lastIndex) && lastIndex >= 0 && lastIndex < count;
  if (!hasLast || count === 1) return draw(count);
  const index = draw(count - 1);
  return index >= lastIndex ? index + 1 : index;
}
