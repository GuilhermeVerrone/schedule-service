// Preço digitado em reais ↔ centavos inteiros (Contexto Mestre: dinheiro nunca em float).
// A conversão é feita sobre o texto, dígito a dígito, sem passar por Number com casas decimais.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCents(cents: number): string {
  // Intl separa "R$" do valor com espaço não separável; o texto visível usa espaço comum.
  return BRL.format(cents / 100).replace(/ /g, " ");
}

// Valor para o campo de edição: "50,00", "1.234,56".
export function centsToInput(cents: number): string {
  return formatCents(cents).replace(/^R\$\s*/, "");
}

// Aceita "50", "50,5", "49,90", "1.234,56", "R$ 80" e também "49.90" (ponto como decimal quando
// há só um ponto seguido de 1 ou 2 dígitos). Devolve null para qualquer outra coisa.
export function parseBrlToCents(raw: string): number | null {
  let text = raw.trim().replace(/^R\$/i, "").replace(/\s/g, "");
  if (text === "") return null;

  if (!text.includes(",") && /^\d+\.\d{1,2}$/.test(text)) text = text.replace(".", ",");

  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(text);
  if (!match) return null;

  const reais = match[1].replace(/\./g, "");
  const centavos = (match[2] ?? "").padEnd(2, "0");
  const cents = Number.parseInt(`${reais}${centavos}`, 10);
  return Number.isSafeInteger(cents) ? cents : null;
}

// Duração para leitura: "45 min", "1 h", "1 h 30 min".
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
