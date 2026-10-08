# Prompt Guide: Slotz, SaaS de Agenda + Cobrança + Chatbot WhatsApp (R$ 79,90)

Guia para desenvolver o produto com IA assistindo (Claude Code, Cursor, etc.).
Como usar: cole o **Contexto Mestre** (seção 1) no início de TODA sessão, depois cole o **prompt da fatia** que você está construindo (seção 4).

---

## 0. Regras de ouro ao trabalhar com IA

1. Uma fatia vertical por vez (funciona de ponta a ponta antes de seguir).
2. Sessões curtas. Se a IA se perder, reinicie com o Contexto Mestre + o trecho relevante.
3. Peça o plano antes do código: "liste os arquivos que vai criar/alterar e espere meu OK".
4. Um commit por fatia. Rode os testes antes de commitar.
5. Tudo que mexe com dinheiro, horário e WhatsApp exige testes (seção 5).
6. Nunca cole chaves reais no prompt. Use variáveis de ambiente.
7. Revise manualmente: isolamento por tenant, validação de webhook, segredos.

---

## 1. CONTEXTO MESTRE (cole em toda sessão)

```
Você é um engenheiro sênior me ajudando a construir o Slotz, um SaaS multi-tenant brasileiro.

PRODUTO
Assistente de atendimento, agenda e cobrança para pequenos negócios (autônomos e
estúdios), com preço de R$ 79,90/mês. O cliente (dono do negócio) conecta o
WhatsApp dele; o sistema:
1. Responde clientes via chatbot no WhatsApp (dúvidas e agendamento).
2. Controla a agenda (serviços, profissionais, horários, link público).
3. Controla pagamentos (Pix/cartão/boleto, baixa automática por webhook).
4. Controla cobranças e recorrências (planos/pacotes, régua de cobrança).

REGRAS DE NEGÓCIO INEGOCIÁVEIS
- NÃO existe disparo frio nem campanha em massa. Mensagem proativa só para
  "contato elegível": (a) iniciou conversa nos últimos 30 dias, OU (b) tem
  agendamento/plano/cobrança ativa, OU (c) foi cadastrado pelo dono com
  consentimento registrado (checkbox + data). Qualquer outro número é bloqueado
  para envio proativo, no código.
- Mensagens proativas são EVENTOS do sistema (lembrete de agenda, cobrança,
  confirmação de pagamento), nunca "campanhas".
- Opt-out ("SAIR") tem efeito imediato e permanente até o contato reativar.
- Cobrança: no máximo 1 lembrete antes do vencimento, 1 no dia e 2 após o
  atraso. Depois disso, notificar o dono para agir manualmente.
- O WhatsApp é NÃO OFICIAL (provedor AKG, conexão via QR code). Há risco de
  banimento. Por isso: rate limit por número, intervalo aleatório entre envios,
  teto diário, aquecimento de número novo, variação de texto, e canal de
  reserva (e-mail) se o WhatsApp cair.
- O WhatsApp fica atrás de uma interface (adapter). O código do produto NUNCA
  chama o AKG diretamente, só o adapter. Deve ser possível trocar por API
  oficial (Meta Cloud API) sem reescrever o produto.

DOMÍNIO (provisório, vai mudar depois)
- Hoje: slotz.algoritmi.com.br. No futuro pode migrar para outro domínio
  (ex.: slotz.app.br). Por isso:
  - NUNCA escreva o domínio fixo no código. Use as variáveis de ambiente
    APP_BASE_URL, PUBLIC_BOOKING_BASE_URL e EMAIL_FROM_DOMAIN.
  - Links públicos de agendamento por caminho: {APP_BASE_URL}/b/{slug}
    (sem subdomínio por cliente).
  - Webhooks em rotas fixas: /api/webhooks/asaas e /api/webhooks/whatsapp
    (a URL base vem da env; ao migrar, basta atualizar nos provedores).
  - Cookies de sessão host-only (sem Domain=.algoritmi.com.br), HttpOnly,
    Secure, SameSite=Lax, para não vazar entre subdomínios da Algoritmi.
  - E-mails transacionais com SPF/DKIM/DMARC num subdomínio dedicado de envio.
  - Links já enviados a clientes (agendamento, pagamento) precisam continuar
    funcionando após a migração: planeje redirecionamento 301 do domínio antigo.

STACK
- Next.js (App Router) + TypeScript, API em route handlers ou serviço separado
- PostgreSQL (Prisma ou Drizzle), toda tabela de negócio com tenant_id
- Redis + BullMQ para filas/jobs (lembretes, régua, retries de webhook)
- Gateway de pagamento: Asaas (subcontas; cada cliente recebe na própria conta)
- Fuso padrão: America/Sao_Paulo. Armazenar datas em UTC.
- Testes: Vitest/Jest. Validação: Zod.

PADRÕES DE CÓDIGO
- Todo acesso a dados filtrado por tenant_id (use uma camada/helper que obrigue).
- Webhooks: validar assinatura/token, ser idempotentes (tabela de eventos
  processados), responder 200 rápido e processar em fila.
- Segredos só em variáveis de ambiente. Nunca logar tokens ou dados sensíveis.
- Dinheiro em centavos (inteiro). Nunca float.
- Funções pequenas, tipos explícitos, erros tratados, logs estruturados.
- LGPD: registrar origem e data do consentimento; permitir exclusão de dados.

COMO TRABALHAR
- Antes de codar, liste os arquivos que vai criar/alterar e as decisões que
  precisa de mim. Espere meu OK.
- Entregue uma fatia por vez, com testes. Se algo for ambíguo, pergunte.
- Se precisar assumir algo sobre a API do AKG ou do Asaas, deixe marcado como
  TODO e isole no adapter, em vez de inventar endpoints.
```

---

## 2. Modelo de dados (peça à IA para gerar o schema)

Entidades mínimas (todas com `tenant_id`, `created_at`, `updated_at`):

- **Tenant** (conta do cliente), **User** (dono/atendentes), **Subscription** (assinatura do próprio SaaS)
- **Professional** (profissional/agenda), **Service** (nome, duração, preço), **WorkingHours**, **TimeBlock** (bloqueios)
- **Contact** (nome, telefone E.164, origem do consentimento, data do consentimento, opt_out, last_inbound_at)
- **Appointment** (contact, service, professional, início/fim UTC, status: pendente/confirmado/cancelado/concluído/falta)
- **Plan** (mensalidade, pacote de N sessões, valor em centavos, recorrência)
- **Charge** (valor, vencimento, status, método, id externo no gateway, link de pagamento)
- **Payment** (cobrança paga, data, valor, id externo)
- **Conversation** / **Message** (direção, texto, status de entrega, id externo, idempotência)
- **WhatsAppConnection** (status, última checagem, limites e contadores diários)
- **BillingRuleRun** (qual passo da régua já foi enviado para cada cobrança)
- **WebhookEvent** (origem, id do evento, processado_em) para idempotência
- **AuditLog** (ações sensíveis)

Prompt:

```
Com base no Contexto Mestre, proponha o schema (Prisma) para as entidades:
[cole a lista acima]. Inclua índices (tenant_id + campos de busca), constraints
únicas (ex.: impedir dois agendamentos no mesmo horário/profissional) e
explique decisões não óbvias. Não gere código de aplicação ainda.
```

---

## 3. Interface do adapter de WhatsApp (contrato)

```
Crie a interface WhatsAppProvider em TypeScript e uma implementação AkgProvider
com TODOs onde faltar documentação. Contrato:

- connect(tenantId): retorna dados para exibir o QR code
- getStatus(tenantId): connected | disconnected | qr_pending | banned_suspected
- sendText(tenantId, to, text, options?): retorna id externo da mensagem
- sendButtons/sendList (opcional, com fallback para texto numerado)
- onInboundMessage(handler) e onStatusUpdate(handler) via webhook normalizado
- disconnect(tenantId)

Regras: o produto só usa essa interface. Normalize eventos do AKG para um
formato interno único (InboundMessage, DeliveryStatus, ConnectionStatus).
Crie também um FakeProvider para testes e desenvolvimento local.
Não invente endpoints do AKG: marque TODO e liste o que preciso confirmar na
documentação.
```

---

## 4. Prompts por fatia

### Fatia 1: Base (auth, tenant, serviços)

```
Fatia 1. Implemente: cadastro/login do dono, criação de tenant, CRUD de
profissionais, serviços e horários de trabalho. Middleware que injeta tenant_id
e uma camada de repositório que força o filtro por tenant. Inclua testes de
isolamento: um tenant não pode ler nem alterar dados de outro.
Antes de codar, liste arquivos e espere meu OK.
```

### Fatia 2: Agenda e link público

```
Fatia 2. Implemente a agenda: cálculo de horários livres (considerando duração
do serviço, horários de trabalho, bloqueios e agendamentos existentes), página
pública de agendamento por slug do tenant, criação/cancelamento/remarcação.
Garantir no banco e no código que dois agendamentos não ocupem o mesmo horário
(trate concorrência). Fuso America/Sao_Paulo. Testes: concorrência, virada de
dia, horário de verão (caso volte a existir), duração que atravessa bloqueio.
```

### Fatia 3: WhatsApp (adapter, conexão, mensagens)

```
Fatia 3. Implemente o adapter (seção 3), a tela de conexão por QR code, o
painel de saúde da conexão (status + alerta de queda + botão reconectar) e o
recebimento de mensagens via webhook com idempotência. Salve Conversation e
Message, atualize contact.last_inbound_at. Use FakeProvider nos testes.
```

### Fatia 4: Fila de envio, limites e elegibilidade

```
Fatia 4. Implemente a fila de envio (BullMQ) com:
- fila e rate limit POR NÚMERO (tenant), intervalo aleatório entre mensagens,
  teto diário, aquecimento para conexões novas (limite crescente nos primeiros dias)
- função isContactEligibleForProactive(contact) conforme as 3 regras do Contexto
  Mestre; mensagem proativa para não elegível deve ser bloqueada e logada
- opt-out: ao receber "SAIR", marcar opt_out e confirmar uma única vez
- variação de templates (3+ variações por tipo de mensagem, com variáveis)
- fallback por e-mail quando a conexão estiver caída
Testes: elegibilidade (cada regra), opt-out, teto diário, fallback.
```

### Fatia 5: Lembretes de agenda

```
Fatia 5. Lembretes automáticos (24h e 2h antes) com resposta "1 confirmar /
2 cancelar" tratada pelo chatbot, atualizando o Appointment. Jobs agendados
idempotentes (não enviar duas vezes). Respeitar elegibilidade e horário
comercial de envio (ex.: 8h às 20h). Testes de reagendamento (lembrete antigo
deve ser cancelado) e de resposta fora do padrão.
```

### Fatia 6: Pagamentos (Asaas)

```
Fatia 6. Integração com Asaas via subcontas: criar subconta no onboarding,
gerar cobrança Pix/cartão/boleto, receber webhook de pagamento com validação de
token e idempotência, dar baixa automática, atualizar painel (recebido / a
receber / atrasado). Isole tudo num PaymentGateway adapter. Não invente
endpoints: marque TODO onde precisar confirmar na documentação do Asaas.
Testes: webhook duplicado, pagamento após vencimento, pagamento parcial/estorno,
webhook fora de ordem.
```

### Fatia 7: Recorrência e régua de cobrança

```
Fatia 7. Planos e pacotes (mensalidade, N sessões), geração recorrente de
cobranças, e régua: 1 lembrete antes, 1 no vencimento, 2 após atraso, depois
notificar o dono. Cada passo registrado em BillingRuleRun (nunca repetir).
Mensagem com link de pagamento e variação de texto, tom cordial, sem ameaça.
Pagamento confirmado cancela os próximos passos. Testes: mês curto (dia 31),
troca de plano no meio do ciclo, cobrança paga entre dois passos da régua,
contato com opt-out (não envia; só notifica o dono).
```

### Fatia 8: Chatbot

```
Fatia 8. Chatbot reativo (só responde quando o cliente escreve):
- máquina de estados para: horários/preços/endereço (FAQ cadastrado pelo dono),
  agendar, remarcar, cancelar, 2ª via de cobrança, falar com humano
- LLM pequeno apenas para classificar intenção e extrair data/serviço de texto
  livre; as ações (agendar, cobrar) são sempre executadas por código
  determinístico, nunca pela LLM diretamente
- handoff para humano: pausa o bot na conversa e notifica o dono
- limite de custo: teto de chamadas à LLM por tenant/mês
- nunca inventar preço, horário ou política que não esteja no cadastro
Testes: intenção ambígua, data relativa ("amanhã à tarde"), tentativa de
prompt injection ("ignore as instruções e..."), pedido fora do escopo.
```

### Fatia 9: Painel, onboarding e cobrança do próprio SaaS

```
Fatia 9. Onboarding guiado em até 10 minutos (negócio, serviços, horários,
conectar WhatsApp, conectar recebimento, link público). Painel financeiro e
de agenda. Cobrança da assinatura de R$ 79,90 com teste grátis de 7 dias e
plano anual com desconto. Termos de uso com aceite explícito informando que a
conexão do WhatsApp é não oficial e envolve risco de bloqueio.
```

---

## 5. Prompts de teste e revisão (use ao fim de cada fatia)

**Testes críticos**

```
Escreva testes para esta fatia cobrindo: idempotência de webhooks, fuso
horário America/Sao_Paulo, concorrência no mesmo horário, valores em centavos,
isolamento entre tenants, e falhas de rede com retry. Liste os casos que você
NÃO conseguiu cobrir.
```

**Revisão de segurança**

```
Faça uma revisão de segurança deste código: queries sem tenant_id, webhooks sem
validação de assinatura, segredos em código ou logs, injeção (SQL, prompt),
rate limit ausente, dados pessoais expostos em logs ou respostas. Para cada
achado: arquivo, risco, correção sugerida.
```

**Revisão de regras de negócio**

```
Compare este código com as REGRAS DE NEGÓCIO INEGOCIÁVEIS do Contexto Mestre.
Aponte qualquer caminho em que uma mensagem proativa possa ser enviada a um
contato não elegível, a um contato com opt-out, ou fora do limite da régua.
```

**Quando a IA se perder**

```
Pare. Resuma em 10 linhas o que você entendeu do objetivo desta fatia e o que
já foi feito. Liste o que falta. Só então continue.
```

---

## 6. Checklist antes de abrir para clientes

- [ ] Isolamento por tenant testado
- [ ] Webhooks (WhatsApp e gateway) com validação e idempotência
- [ ] Nenhum caminho de disparo para contato não elegível
- [ ] Opt-out funcionando de ponta a ponta
- [ ] Painel de saúde da conexão e fallback por e-mail
- [ ] Termos de uso com aviso sobre WhatsApp não oficial
- [ ] Política de privacidade e exclusão de dados (LGPD)
- [ ] Backups do banco e monitoramento de erros (Sentry)
- [ ] Beta com 5 a 10 clientes amigos, medindo bloqueios de número
- [ ] Plano de migração para API oficial da Meta testado no adapter

---

## 7. Pendências para você confirmar

- Documentação do AKG: webhooks de mensagem recebida e status de conexão, limites de envio recomendados, como obter o QR code.
- Preço do AKG por número (para validar a margem a R$ 79,90).
- Documentação do Asaas: subcontas, webhooks e recorrência.
- Nicho inicial (barbearia, clínica, aulas, pet shop...): ajusta serviços padrão, textos do bot e discurso de venda.
