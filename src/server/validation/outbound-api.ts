import { z } from "zod";
import { MAX_VARIATION_LENGTH, MAX_VARIATIONS, MIN_VARIATIONS, type TemplateIssue } from "@/server/outbound/templates";

// Entrada das rotas do painel de envios e templates (guia 3, 7f; D5, D6, D16). Tenant e tipo da
// mensagem nunca vêm do cliente: o tenant é da sessão e o tipo é do template já gravado (lista
// fechada). Campos extras são ignorados. As regras do conteúdo (mínimo de variações, variáveis,
// duplicadas) ficam em `normalizeVariations`, a mesma validação do repositório.

const VARIATIONS_ERROR = "Envie as variações como uma lista de textos.";

export const templateUpdateSchema = z.object({
  variations: z
    .array(z.string({ error: VARIATIONS_ERROR }), { error: VARIATIONS_ERROR })
    // Folga acima dos limites reais: o excesso cai na validação do template com a mensagem certa,
    // mas um corpo absurdo para aqui.
    .max(MAX_VARIATIONS * 5, { error: `Use no máximo ${MAX_VARIATIONS} variações.` })
    .refine((list) => list.every((text) => text.length <= MAX_VARIATION_LENGTH * 5), {
      error: `Cada variação pode ter no máximo ${MAX_VARIATION_LENGTH} caracteres.`,
    }),
});

const position = (index: number) => `A variação ${index + 1}`;

export function templateIssueMessage(issue: TemplateIssue): string {
  switch (issue.code) {
    case "too_few":
      return `Escreva pelo menos ${MIN_VARIATIONS} variações.`;
    case "too_many":
      return `Use no máximo ${MAX_VARIATIONS} variações.`;
    case "empty":
      return `${position(issue.index)} está vazia.`;
    case "too_long":
      return `${position(issue.index)} passa de ${MAX_VARIATION_LENGTH} caracteres.`;
    case "duplicate":
      return `${position(issue.index)} repete outra variação.`;
    case "malformed_variable":
      return `${position(issue.index)} tem uma variável mal escrita. Use o formato {{nome}}.`;
    case "unknown_variable":
      return `${position(issue.index)} usa a variável {{${issue.variable.slice(0, 40)}}}, que não existe para esta mensagem.`;
  }
}
