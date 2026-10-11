import type { OutboundMessageType } from "@/server/outbound/message-types";
import { renderTemplate, TEMPLATE_VARIABLES, validateVariations, type TemplateVariables } from "@/server/outbound/templates";
import { templateIssueMessage } from "@/server/validation/outbound-api";
import type { TemplateIssueDto } from "./templates-api";

// Textos de /painel/mensagens: quando cada tipo sai, o nome de cada variável, os dados de exemplo
// da pré-visualização e a mesma validação do servidor (templates.ts), para o erro aparecer antes
// de salvar. A pré-visualização é texto puro, como o WhatsApp recebe (nunca HTML).

export const MESSAGE_TYPE_DETAILS: Record<OutboundMessageType, string> = {
  appointment_confirmation: "Sai quando um agendamento é confirmado, com o serviço, a data e o horário.",
  optout_confirmation: "Sai uma única vez quando o cliente responde SAIR, para confirmar que ele não recebe mais mensagens automáticas.",
};

const VARIABLE_LABELS: Record<string, string> = {
  nome: "Nome do cliente",
  negocio: "Nome do negócio",
  servico: "Serviço",
  profissional: "Profissional",
  data: "Data",
  hora: "Horário",
};

export const variableLabel = (variable: string): string => VARIABLE_LABELS[variable] ?? variable;

// Dados de exemplo no formato que o worker usa (content.ts: data dd/MM/yyyy, hora HH:mm).
export const SAMPLE_VALUES: TemplateVariables<"appointment_confirmation"> = {
  nome: "Mariana",
  negocio: "Estúdio Aurora",
  servico: "Corte e escova",
  profissional: "Bia",
  data: "15/10/2026",
  hora: "14:30",
};

// Só as variáveis do tipo recebem valor; a desconhecida fica como está no texto (renderTemplate
// não troca o que não conhece), do jeito que a validação vai apontar.
export function previewText(type: OutboundMessageType, text: string): string {
  const values = Object.fromEntries(TEMPLATE_VARIABLES[type].map((variable) => [variable, SAMPLE_VALUES[variable]]));
  return renderTemplate(text, values as TemplateVariables<typeof type>);
}

export function localIssues(type: OutboundMessageType, variations: readonly string[]): TemplateIssueDto[] {
  return validateVariations(type, variations).map((issue) => ({ ...issue, message: templateIssueMessage(issue) }));
}
