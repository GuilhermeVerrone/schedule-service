import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localIssues, MESSAGE_TYPE_DETAILS, previewText, SAMPLE_VALUES, variableLabel } from "@/components/painel/messages/template-text";
import { OUTBOUND_MESSAGE_TYPES } from "@/server/outbound/message-types";
import { DEFAULT_TEMPLATES, TEMPLATE_VARIABLES } from "@/server/outbound/templates";

// Fase 11 (D5, D16): textos da tela de templates, pré-visualização em texto puro e a mesma
// validação do servidor antes de salvar.

describe("textos da tela de mensagens", () => {
  it("todo tipo da lista fechada tem descrição e toda variável tem nome e valor de exemplo", () => {
    for (const type of OUTBOUND_MESSAGE_TYPES) {
      expect(MESSAGE_TYPE_DETAILS[type]).toBeTruthy();
      for (const variable of TEMPLATE_VARIABLES[type]) {
        expect(variableLabel(variable)).not.toBe(variable);
        expect(SAMPLE_VALUES[variable as keyof typeof SAMPLE_VALUES]).toBeTruthy();
      }
    }
  });

  it("pré-visualiza os textos padrão sem sobrar variável", () => {
    for (const type of OUTBOUND_MESSAGE_TYPES) {
      for (const text of DEFAULT_TEMPLATES[type]) {
        const preview = previewText(type, text);
        expect(preview).not.toMatch(/\{\{|\}\}/);
        expect(preview).toContain(SAMPLE_VALUES.nome);
      }
    }
  });

  it("variável de outro tipo ou desconhecida fica literal, e HTML continua texto", () => {
    expect(previewText("optout_confirmation", "{{nome}} {{servico}} {{xyz}}")).toBe("Mariana {{servico}} {{xyz}}");
    expect(previewText("appointment_confirmation", "<b>{{nome}}</b>")).toBe("<b>Mariana</b>");
  });

  it("valida como o servidor: variável desconhecida, vazia e poucas variações", () => {
    const issues = localIssues("optout_confirmation", ["Oi {{nome}}", "Oi {{servico}}", " "]);
    expect(issues).toEqual([
      expect.objectContaining({ code: "unknown_variable", index: 1, message: "A variação 2 usa a variável {{servico}}, que não existe para esta mensagem." }),
      expect.objectContaining({ code: "empty", index: 2, message: "A variação 3 está vazia." }),
    ]);
    expect(localIssues("optout_confirmation", ["a", "b"])[0]).toMatchObject({ code: "too_few", message: "Escreva pelo menos 3 variações." });
    expect(localIssues("appointment_confirmation", [...DEFAULT_TEMPLATES.appointment_confirmation])).toEqual([]);
  });

  it("sem travessão nos textos da tela", () => {
    for (const file of ["src/components/painel/messages/template-text.ts", "src/components/painel/messages/templates-screen.tsx"]) {
      const text = readFileSync(file, "utf8");
      const visible = [...text.matchAll(/"([^"\n]*)"|>([^<>{}\n]+)</g)].map((match) => match[1] ?? match[2]).join("\n");
      expect(visible).not.toMatch(/[–—]/);
    }
  });
});
