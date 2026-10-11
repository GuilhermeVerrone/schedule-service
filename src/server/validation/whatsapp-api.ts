import { z } from "zod";

// Entrada das rotas do painel do WhatsApp (guia 7d; D6, D7). Só a página: conexão, conversa e
// tenant vêm da sessão e da URL, nunca de campo enviado pelo cliente (campos extras são ignorados).

const PAGE_ERROR = "Página inválida: use um número inteiro a partir de 1.";

export const pageQuerySchema = z.object({
  page: z.coerce.number({ error: PAGE_ERROR }).int({ error: PAGE_ERROR }).min(1, { error: PAGE_ERROR }).max(10_000, { error: PAGE_ERROR }).default(1),
});
