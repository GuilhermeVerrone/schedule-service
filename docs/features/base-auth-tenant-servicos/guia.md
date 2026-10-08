# Guia: Base do Slotz (auth, tenant, serviços)

Slug: `base-auth-tenant-servicos` (Fatia 1 do prompt-guide.md na raiz). Status: aprovado em 2026-10-08.

1. **feature:** Base do Slotz: cadastro/login do dono, tenant, profissionais, serviços e horários de trabalho.
2. **resumo:** O dono de um pequeno negócio cria conta, ganha um tenant isolado e cadastra profissionais, serviços e horários de atendimento.
3. **interface:** App web Next.js (App Router). Telas /cadastro, /login e /painel (profissionais, serviços, horários). API em route handlers. Visual no padrão da Algoritmi (`../algoritmi/DESIGN.md`).
4. **perfis:** Dono (`owner`): acesso total ao próprio tenant. Nenhum perfil enxerga dados de outro tenant. Sem atendentes nesta fatia.
5. **dados:** Tenant, User, Session, LoginAttempt, Professional, Service, ProfessionalService (N:N), WorkingHours. Tabelas de negócio com tenant_id, created_at, updated_at.
6. **regras:**
   - Todo acesso a dados passa por repositório que força filtro por tenant_id; middleware injeta tenant_id da sessão.
   - Dinheiro em centavos inteiros. Fuso America/Sao_Paulo, datas em UTC.
   - Validação com Zod.
   - Cookie de sessão host-only, HttpOnly, Secure, SameSite=Lax.
   - Segredos só em variáveis de ambiente.
7. **jornadas:**
   - (a) Dono se cadastra, tenant é criado e ele entra logado.
   - (b) Dono faz login e logout.
   - (c) Dono cadastra, edita e arquiva/remove profissionais, serviços e horários.
   - (d) Tentativa de ler/alterar dado de outro tenant é negada.
8. **fora:** Agenda, link público, WhatsApp, pagamentos, cobrança, chatbot, métricas, assinatura do SaaS (Fatias 2 a 9). Verificação de e-mail e recuperação de senha.
9. **pronto:**
   - Cadastro e login funcionam de ponta a ponta.
   - CRUD de profissionais, serviços e horários funciona.
   - Testes de isolamento passam (repositório e API): tenant A não lê nem altera dados do B.
   - Nenhuma query de negócio contorna o filtro de tenant.
   - Sem segredo no repositório.
