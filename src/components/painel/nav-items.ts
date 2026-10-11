// Navegação do painel (D7). As telas de profissionais e serviços chegam na Fase 6; os horários
// ficam dentro de cada profissional (/painel/profissionais/[id]/horarios). Configurações do
// negócio e da agenda na Fatia 2 (agenda-link-publico, Fase 6); a agenda do dia e da semana na Fase 7.
// Conexão do WhatsApp e conversas na Fatia 3 (whatsapp-conexao-mensagens, Fases 6 e 7).
export const PANEL_NAV = [
  { href: "/painel", label: "Início", exact: true },
  { href: "/painel/agenda", label: "Agenda", exact: false },
  { href: "/painel/profissionais", label: "Profissionais", exact: false },
  { href: "/painel/servicos", label: "Serviços", exact: false },
  { href: "/painel/conversas", label: "Conversas", exact: false },
  { href: "/painel/whatsapp", label: "WhatsApp", exact: false },
  { href: "/painel/configuracoes", label: "Configurações", exact: false },
] as const;
