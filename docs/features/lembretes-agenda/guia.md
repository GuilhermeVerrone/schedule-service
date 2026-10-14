# Guia: Lembretes de agenda

Slug: `lembretes-agenda` (Fatia 5 do prompt-guide.md na raiz). Status: passo 1, guia atualizado com configuração por tenant (ligar/desligar), aguardando aprovação. Depende da Fatia 4 concluída (fila `enqueueMessage`, elegibilidade, templates, worker).

1. **feature:** Lembretes automáticos de agendamento (24 h e 2 h antes) com resposta do cliente "1 confirmar / 2 cancelar".
2. **resumo:** Cada agendamento `confirmed` gera dois lembretes proativos pelo WhatsApp (fila da Fatia 4); o cliente responde 1 ou 2 e o sistema atualiza o agendamento.
3. **interface:** Bloco "Lembretes" em `/painel/configuracoes` (ligar/desligar cada lembrete) e API de configurações do tenant. Sem outra tela nova. Agendamento de jobs e tratamento da resposta em `src/server` e no worker; novos tipos de mensagem `appointment_reminder_24h` e `appointment_reminder_2h` (texto editável pelo dono na tela de templates da Fatia 4). Ponto de entrada da resposta: webhook do WhatsApp (Fatia 3). Indicação de "confirmado pelo cliente" na agenda do painel: ?
4. **perfis:** Sistema (agenda e envia); Dono (`owner`) liga/desliga cada lembrete do próprio tenant; Cliente final (recebe, responde 1, 2 ou outra coisa); Dono (`owner`, vê o resultado na agenda do tenant dele). Isolamento por tenant continua valendo.
5. **dados:**
   - Appointment (Fatia 2): `startsAt`, `status` (`confirmed | canceled | completed`), `canceledAt`. Status "confirmado pelo cliente" (campo ou valor novo): ?
   - OutboundMessage (Fatia 4): um registro por lembrete, chave de idempotência `appointment_reminder_<24h|2h>:<appointmentId>:<startsAt>`.
   - Configuração por tenant: `reminder24hEnabled` e `reminder2hEnabled` (booleanos, padrão ligado), em `Tenant` ou tabela de configurações existente: ?
   - Job agendado (BullMQ, atraso até a hora do lembrete) por lembrete, com id determinístico.
   - Contact: `opt_out`, `last_inbound_at`, e-mail (fallback já existente).
   - MessageTemplate: 3 ou mais variações por tipo novo; os dois CHECKs de tipo mudam na mesma migração (pendência 6 da Fatia 4).
   - Vínculo entre resposta do cliente e o agendamento a que se refere (lembrete mais recente enviado ao contato): ?
6. **regras:**
   - Só agendamento `confirmed` e futuro tem lembrete; lembrete 24 h só se faltar mais de 24 h na criação, o de 2 h só se faltar mais de 2 h.
   - Lembrete desligado pelo dono não é agendado; desligar cancela os jobs e registros pendentes dos agendamentos futuros, ligar agenda os dos agendamentos futuros ainda dentro da antecedência. Mudança de configuração afeta só o que ainda não foi enviado.
   - Respeita elegibilidade (regra b vale: agendamento `confirmed`), opt-out, teto diário, aquecimento e fallback por e-mail da Fatia 4.
   - Horário de envio: 8h às 20h do fuso do tenant; fora disso espera (D11). Lembrete de 2 h que cairia fora da janela: ?
   - Idempotência: o mesmo lembrete nunca sai duas vezes (chave de idempotência + job id determinístico).
   - Reagendar ou cancelar: lembretes antigos são cancelados (job removido e registro não enviado) e novos são criados para o novo horário.
   - Lembrete só sai se o agendamento ainda for `confirmed` e o horário continuar o mesmo no momento do envio (checagem na hora de enviar, além de remover o job).
   - Lembrete que atrasou mais de 24 h vira `expired` (D7 da Fatia 4); lembrete cujo horário do agendamento já passou nunca é enviado: ?
   - Resposta "1": confirma o agendamento (marca confirmação do cliente); "2": cancela o agendamento (`canceled`, libera o horário) e cancela lembretes pendentes; ambas respondem com uma mensagem curta de retorno pela fila.
   - Resposta fora do padrão (texto livre, "3", "um"): não altera o agendamento; resposta única orientando "responda 1 ou 2" sem repetir a cada mensagem: ?
   - Resposta só vale se houver lembrete enviado ao contato para agendamento ainda futuro e `confirmed`; senão ignora (opt-out "SAIR" segue na Fatia 4).
   - Cliente com mais de um agendamento futuro: a resposta vale para o lembrete mais recente enviado: ?
   - Falha na fila ou Redis fora do ar: o agendamento não é afetado; falha visível no registro (D12).
7. **jornadas:**
   - (a) Agendamento criado (público ou manual): 2 lembretes agendados.
   - (b) Chega a hora: worker envia o lembrete pela fila da Fatia 4.
   - (c) Cliente responde 1: agendamento marcado como confirmado pelo cliente.
   - (d) Cliente responde 2: agendamento cancelado, horário liberado.
   - (e) Dono ou cliente reagenda ou cancela: lembretes antigos somem e, se reagendou, novos entram.
   - (f) Cliente responde algo fora do padrão: agendamento intacto, orientação enviada.
   - (g) Dono desliga o lembrete de 2 h nas configurações: os pendentes somem e novos agendamentos não o geram.
   - (h) Contato em opt-out, WhatsApp caído ou teto atingido: comportamento da Fatia 4.
8. **fora:** Chatbot completo, intenção livre e conversa (Fatia 8); campanhas; lembretes de cobrança (Fatias 6 e 7); botões e lista; antecedência e janela de envio configuráveis (fixas em 24 h e 2 h, 8h às 20h; pendência para depois); lembrete para o dono; confirmação de agendamento ainda não enfileirada (pendência 5 da Fatia 4): ?; deploy e `AkgProvider` real.
9. **pronto:**
   - Teste de idempotência: reprocessar o mesmo lembrete não gera segundo envio.
   - Teste de reagendamento: lembrete do horário antigo é cancelado e os novos são criados.
   - Teste de cancelamento: sem lembrete pendente depois.
   - Testes da resposta 1, 2 e fora do padrão (incluindo sem lembrete anterior e com opt-out).
   - Teste de ligar/desligar: lembrete desligado não é agendado e desligar remove os pendentes.
   - Teste de janela 8h-20h no fuso do tenant e de elegibilidade/opt-out nos lembretes.
   - Nenhum lembrete sai sem passar por `enqueueMessage`.
   - Migração dos tipos de mensagem aplicada nos dois CHECKs; templates padrão criados para tenants novos e existentes.
