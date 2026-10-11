import { apiRequest, type ApiResult } from "@/components/painel/catalog/api-client";
import type { OutboundMessageType } from "@/server/outbound/message-types";

// Chamadas de /painel/mensagens (guia 3; D5, D16) às rotas de templates da Fase 9. O corpo segue
// messageTemplateDto (serializers.ts). Não há criar nem excluir: o tipo é do sistema.

export interface MessageTemplateDto {
  id: string;
  messageType: OutboundMessageType;
  variations: string[];
  active: boolean;
  variables: string[];
  isDefault: boolean;
  limits: { minVariations: number; maxVariations: number; maxLength: number };
  updatedAt: string;
}

// Problema de uma variação como a API devolve (TemplateIssue + texto pronto); sem `index` vale
// para a lista inteira (poucas ou demais variações).
export interface TemplateIssueDto {
  code: string;
  index?: number;
  variable?: string;
  message: string;
}

export async function fetchTemplates(): Promise<ApiResult<MessageTemplateDto[]>> {
  const result = await apiRequest<{ templates: MessageTemplateDto[] }>("GET", "/api/message-templates");
  return result.ok ? { ok: true, data: result.data.templates } : result;
}

export async function saveVariations(id: string, variations: string[]): Promise<ApiResult<MessageTemplateDto>> {
  const result = await apiRequest<{ template: MessageTemplateDto }>("PATCH", `/api/message-templates/${id}`, { variations });
  return result.ok ? { ok: true, data: result.data.template } : result;
}

export async function restoreDefault(id: string): Promise<ApiResult<MessageTemplateDto>> {
  const result = await apiRequest<{ template: MessageTemplateDto }>("POST", `/api/message-templates/${id}/restore`);
  return result.ok ? { ok: true, data: result.data.template } : result;
}

export function templateIssues(issues: unknown[] | undefined): TemplateIssueDto[] {
  return (issues ?? []).filter(
    (issue): issue is TemplateIssueDto =>
      typeof issue === "object" && issue !== null && typeof (issue as TemplateIssueDto).message === "string",
  );
}
