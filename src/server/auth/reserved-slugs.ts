// Slugs que tenants não podem usar (D1): o site público fica em /{slug} e divide a raiz com as
// rotas do próprio Slotz. Inclui rotas atuais e nomes reservados para o futuro.
// A migração 20261010*_agenda_link_publico renomeia tenants antigos com estes slugs; ao
// acrescentar um nome aqui, crie migração que renomeie quem já o usa.

export const RESERVED_SLUGS: readonly string[] = [
  // Rotas e arquivos do app
  "api",
  "b",
  "cadastro",
  "login",
  "logout",
  "painel",
  "fonts",
  "favicon",
  "robots",
  "sitemap",
  "manifest",
  "next",
  "static",
  "assets",
  "public",
  // Reservados para telas e páginas futuras
  "admin",
  "agenda",
  "agendamento",
  "agendar",
  "ajuda",
  "app",
  "auth",
  "blog",
  "configuracoes",
  "conta",
  "contato",
  "docs",
  "entrar",
  "health",
  "planos",
  "precos",
  "privacidade",
  "sair",
  "sobre",
  "status",
  "suporte",
  "termos",
  "webhooks",
  "www",
  // Marca
  "algoritmi",
  "slotz",
];

const reserved = new Set(RESERVED_SLUGS);

export function isReservedSlug(slug: string): boolean {
  return reserved.has(slug);
}
