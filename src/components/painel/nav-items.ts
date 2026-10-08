// Navegação do painel (D7). As telas de profissionais e serviços chegam na Fase 6; os horários
// ficam dentro de cada profissional (/painel/profissionais/[id]/horarios).
export const PANEL_NAV = [
  { href: "/painel", label: "Início", exact: true },
  { href: "/painel/profissionais", label: "Profissionais", exact: false },
  { href: "/painel/servicos", label: "Serviços", exact: false },
] as const;
