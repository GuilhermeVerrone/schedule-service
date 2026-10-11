# Guia: Agenda e link público

Slug: `agenda-link-publico` (Fatia 2 do prompt-guide.md na raiz). Status: aprovado em 2026-10-10 (revisado após o discovery).

1. **feature:** Agenda do negócio e mini-site público com agendamento, por slug do tenant.
2. **resumo:** O cliente final navega no site do negócio e agenda serviço, profissional e horário livre sem login; o dono configura o negócio e gerencia a agenda no painel.
3. **interface:** Site público em `/{slug}` com menu: Início, Serviços, Equipe e Agendar (fluxo em passos). Painel: `/painel/agenda` (dia e semana) e `/painel/configuracoes` (dados do negócio e parâmetros da agenda). Endpoints públicos e autenticados em `src/app/api`. Visual no padrão da Algoritmi.
4. **perfis:** Cliente final (anônimo, só o site do tenant do slug); Dono (`owner`, agenda e configurações do próprio tenant). Isolamento por tenant continua valendo.
5. **dados:**
   - Customer (por tenant): nome, telefone normalizado, e-mail opcional.
   - Appointment: tenant, profissional, serviço, cliente, início e fim em UTC, status `confirmed | canceled | completed`, hash do token de gestão.
   - TimeBlock: profissional, início, fim, motivo opcional.
   - Tenant ganha: descrição, endereço, telefone e parâmetros da agenda (passo da grade, buffer, antecedência mínima, janela máxima, prazo de cancelamento pelo cliente).
   - Reaproveita Tenant.slug/timezone, Professional, Service (duração), ProfessionalService, WorkingHours.
6. **regras:**
   - Horário livre = horário de trabalho do profissional − bloqueios − agendamentos `confirmed`, comportando duração do serviço e buffer, na grade configurada, respeitando antecedência mínima e janela máxima.
   - Parâmetros padrão: passo 15 min, buffer 0, antecedência 2 h, janela 60 dias, prazo de cancelamento 2 h; configuráveis por tenant.
   - Dois agendamentos `confirmed` do mesmo profissional não se sobrepõem: exclusion constraint no Postgres (`btree_gist`) e tratamento no código (violação vira 409; a tela recarrega os horários).
   - Fuso do tenant (padrão America/Sao_Paulo) via biblioteca de fuso, nunca somando horas fixas; datas em UTC no banco; cobre virada de dia e horário de verão.
   - Só profissionais e serviços não arquivados e vinculados aparecem no site; "qualquer profissional disponível" é uma opção do fluxo.
   - Slugs reservados (`login`, `cadastro`, `painel`, `api` e outros) não podem ser usados por tenants.
   - Cliente: nome e telefone obrigatórios; telefone normalizado (só dígitos, DDI 55) e usado para reencontrar o cliente; consentimento LGPD no formulário.
   - Gestão pelo cliente: link `/{slug}/agendamento/{token}` (token aleatório, só o SHA-256 no banco), exibido na tela de confirmação; cancelar e remarcar valem até o prazo configurado. Sem e-mail nem WhatsApp nesta fatia.
   - Limite de requisições por IP na rota pública de agendamento, reaproveitando a tabela de tentativas.
   - Acesso por repositório com tenantId; rotas públicas resolvem o tenant pelo slug.
7. **jornadas:**
   - (a) Cliente abre `/{slug}`, navega pelo menu, escolhe serviço, profissional e horário, informa nome e telefone e confirma; guarda o link de gestão.
   - (b) Dois clientes tentam o mesmo horário ao mesmo tempo: um confirma, o outro recebe erro e vê horários atualizados.
   - (c) Cliente cancela ou remarca pelo link de gestão, dentro do prazo.
   - (d) Dono vê a agenda (dia/semana), cria agendamento manual, cancela, remarca, marca como concluído e cria ou remove bloqueios.
   - (e) Dono edita dados do negócio e parâmetros da agenda em `/painel/configuracoes`.
   - (f) Slug inexistente ou dado de outro tenant responde 404.
8. **fora:** WhatsApp (Fatia 3, implementação real), e-mail, lembretes, confirmação por mensagem, fila de envio, pagamentos, cobrança, recorrência/pacotes, chatbot, métricas, assinatura do SaaS (Fatias 3 a 9). Verificação de contato do cliente. Recorrência de bloqueios. Fotos e personalização visual do site além de texto básico.
9. **pronto:**
   - Cliente navega no site e agenda de ponta a ponta (Playwright, mobile e desktop).
   - Horários livres corretos: duração, buffer, horário de trabalho, bloqueios, agendamentos, antecedência e janela.
   - Concorrência: agendamentos simultâneos no mesmo horário resultam em um só; o banco recusa sobreposição mesmo contornando o código.
   - Testes de virada de dia, duração que atravessa bloqueio e fuso/horário de verão.
   - Criar, cancelar e remarcar (cliente e dono) liberam e ocupam horários corretamente; prazo de cancelamento respeitado.
   - Parâmetros alterados em `/painel/configuracoes` mudam o cálculo dos horários.
   - Testes de isolamento de tenant na API e no repositório para as novas tabelas.
   - Sem segredo no repositório.
