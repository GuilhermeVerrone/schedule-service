# Decisões: base-auth-tenant-servicos (aprovadas em 2026-10-08)

| # | Decisão | Origem |
|---|---|---|
| D1 | Auth própria: argon2, sessão no banco, cookie host-only/HttpOnly/Secure/SameSite=Lax. Senha mín. 8 caracteres; limite de tentativas por e-mail e IP. Sem verificação de e-mail nem recuperação de senha. | Usuário, 2026-10-08 |
| D2 | Prisma + Postgres no Neon (branches dev e test). Isolamento só por repositório + testes. Sem RLS. | Usuário |
| D3 | Tenant: nome do negócio, slug único gerado do nome no cadastro, fuso padrão America/Sao_Paulo. | Usuário |
| D4 | Só papel `owner`. Coluna `role` existe; sem convite/atendentes. | Usuário |
| D5 | Serviço×profissional N:N. Horários por profissional, vários intervalos por dia, sem sobreposição, fim > início. Duração em múltiplos de 5 min (5 a 480). Preço em centavos, >= 0. | Usuário |
| D6 | Profissionais e serviços arquivados (`archived_at`). Horários de trabalho apagados de verdade. | Usuário |
| D7 | Tailwind + shadcn/ui, mobile-first. Rotas /cadastro, /login, /painel/profissionais, /painel/servicos, /painel/profissionais/[id]/horarios. Estados vazio/carregando/erro, Sonner. API em route handlers com Zod; erros `{ error: { code, message } }`. | Usuário |
| D8 | Front segue o design system da Algoritmi: `../algoritmi/DESIGN.md` (tokens, tipografia, componentes), `../algoritmi/PRODUCT.md` e `../algoritmi/.impeccable/design.json`. Violeta #492DEB, Poppins nos títulos, Manrope no texto, papel #F2F2F2, controles de 10px. Os tokens entram no tema Tailwind e do shadcn/ui na Fase 1; as telas (Fases 5 e 6) só usam esses tokens, sem cores ou fontes soltas. | Usuário, 2026-10-08 |

## Premissas
a. E-mail único globalmente, normalizado em minúsculas.
b. Cadastro cria Tenant+User em transação e abre a sessão; slug com sufixo numérico em colisão.
c. Sessão de 30 dias com renovação deslizante; logout apaga a sessão no banco.
d. Limite de tentativas em tabela Postgres (sem Redis nesta fatia).
e. Erros de login genéricos.
f. Vitest contra a branch de teste do Neon; testes de isolamento no repositório e na API; teste que falha se houver query de negócio fora do repositório.
g. LGPD: só e-mail e hash de senha do dono; exclusão de conta fica para fatia futura.
h. Índices em tenant_id e campos de busca; sem paginação.
i. Segredos em .env; .env.example versionado; .env no .gitignore.

## Notas para fatias futuras (não fazem parte da Fatia 1)
- WhatsApp (Fatia 3): só WA-AKG por enquanto, atrás da interface `WhatsAppProvider` (Meta Cloud API fica como opção futura via novo provider). Uma sessão WA-AKG por tenant, em `WhatsAppConnection`; cliente conecta por QR code; aviso de risco de banimento no onboarding.
- Confirmar no Swagger (/docs) de uma instância: criar sessão, obter QR, formato do webhook. Não usar o endpoint `broadcast`.
- Anti-banimento e elegibilidade de contato (leads quentes: conversa nos últimos 30 dias ou agendamento/plano/cobrança ativa; ou opt-in registrado) ficam no Slotz (Fatia 4).
- Confirmar se preenchimento do link público conta como agendamento ativo (Fatia 2).
