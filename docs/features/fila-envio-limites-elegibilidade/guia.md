# Guia: Fila de envio, limites e elegibilidade

Slug: `fila-envio-limites-elegibilidade` (Fatia 4 do prompt-guide.md na raiz). Status: discovery concluído em 2026-10-11 (ver decisoes.md), aprovado em 2026-10-11. Depende da Fatia 3 concluída.

1. **feature:** Fila de envio do WhatsApp por número com limites anti-banimento, regra de elegibilidade para mensagem proativa, opt-out e fallback por e-mail.
2. **resumo:** Toda mensagem que o sistema envia passa por uma fila por tenant que espaça os envios, respeita teto diário e aquecimento, bloqueia contatos não elegíveis, respeita "SAIR" e cai para e-mail quando o WhatsApp está fora.
3. **interface:** Sem tela nova obrigatória. uso diário, aquecimento e bloqueios em `/painel/whatsapp` (somente leitura) e tela de edição de templates (D5, D6); resposta manual fica fora (Fatia 8). Serviço de envio único `enqueueMessage` em `src/server`; worker da fila. Visual no padrão da Algoritmi, se houver tela.
4. **perfis:** Sistema (produz eventos de envio); Dono (`owner`, vê uso e bloqueios do próprio tenant); Cliente final (recebe, responde, pode escrever "SAIR"). Isolamento por tenant continua valendo.
5. **dados:**
   - Fila BullMQ no Redis (Redis em contêiner Docker na VPS, D1).
   - Registro de cada envio: tenant, contato, tipo de mensagem, canal (`whatsapp` | `email`), status (`queued | sent | failed | blocked`), motivo do bloqueio, id externo, horário.
   - WhatsAppConnection (Fatia 3): contadores e limites diários passam a ser usados; data de início para o aquecimento.
   - Contact (Fatia 3): `opt_out` e `last_inbound_at` passam a ser usados; marcador de confirmação de opt-out já enviada.
   - Templates: 3 ou mais variações por tipo de mensagem, com variáveis (no banco, editáveis pelo dono, D5).
6. **regras:**
   - Elegível para proativo = (a) escreveu nos últimos 30 dias (`last_inbound_at`), OU (b) tem agendamento `confirmed`, plano ou cobrança ativa, OU (c) foi cadastrado pelo dono com consentimento registrado (`consent_at`). Senão é bloqueado no código, registrado com motivo e nunca enviado.
   - `opt_out` bloqueia qualquer proativo, sem exceção, até o contato reativar.
   - Fila e limite por número (tenant): intervalo aleatório entre mensagens (8 a 25 s), teto diário, aquecimento com limite crescente nos primeiros dias da conexão (14 dias).
   - Receber "SAIR" (`SAIR`, `PARAR`, `CANCELAR`, `STOP`; `VOLTAR` reativa) marca `opt_out` na hora e responde uma única confirmação.
   - Conexão caída ou `banned_suspected`: envio vai por e-mail (contato sem e-mail fica `blocked` com `no_channel`).
   - Só o adapter fala com o AKG; o envio da fila usa `sendText`.
   - Idempotência: o mesmo evento não gera dois envios.
   - Retentativa com limite e sem estourar o teto; falha final registrada.
   - Segredos (Redis, e-mail) só em variáveis de ambiente. `EMAIL_FROM_DOMAIN` já existe no `.env.example`.
7. **jornadas:**
   - (a) Evento do sistema (ex.: confirmação de agendamento) vira mensagem na fila; o worker envia respeitando intervalo, teto e aquecimento.
   - (b) Contato não elegível: o envio é bloqueado e fica registrado com o motivo.
   - (c) Cliente escreve "SAIR": opt-out imediato, uma única confirmação, nada proativo depois.
   - (d) WhatsApp cai: o envio segue por e-mail e o painel mostra o alerta da Fatia 3.
   - (e) Teto diário atingido: o restante espera o dia seguinte ou expira se passar de 24 h (D7).
   - (f) Dono vê o uso diário e os bloqueios (sim, D6).
8. **fora:** Lembretes de agenda (Fatia 5); pagamentos e régua de cobrança (Fatias 6 e 7); chatbot e respostas automáticas (Fatia 8); botões e lista; campanhas e disparos em massa (não existem no produto); API oficial da Meta; parte real do `AkgProvider` se o Swagger ainda não existir.
9. **pronto:**
   - Testes de elegibilidade para cada uma das 3 regras e para o caso bloqueado.
   - Testes de opt-out (efeito imediato, confirmação única, reativação).
   - Testes de teto diário, intervalo e aquecimento.
   - Teste de fallback por e-mail com conexão caída.
   - Nenhuma mensagem proativa sai sem passar pela fila e pela função de elegibilidade.
   - Sem segredo no repositório; `.env.example` com os nomes novos (Redis e e-mail).
