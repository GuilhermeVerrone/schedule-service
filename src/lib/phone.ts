// Telefone do contato em E.164 (D2, D11 da Fatia 3): "+", DDI e número, como +5511987654321.
// Única porta de entrada do telefone (painel, link público e, na Fatia 3, o WhatsApp). Roda no
// servidor e no navegador. O CHECK contacts_phone_check garante o formato geral no banco.

// "+" e 10 a 15 dígitos, sem zero no início do DDI.
const E164 = /^\+[1-9]\d{9,14}$/;

const BR_DDI = "55";

// Brasil: DDD (dois dígitos de 1 a 9) + celular com o nono dígito (9 + 8 dígitos) ou 8 dígitos
// começando de 2 a 9 (fixo, ou celular sem o nono dígito, como o WhatsApp ainda identifica contas
// antigas). Com 9 dígitos, o primeiro é sempre 9. O nono dígito nunca é inserido nem removido.
const BR_NATIONAL = /^[1-9]{2}(?:9\d{8}|[2-9]\d{7})$/;

// Só o que aparece num telefone digitado: dígitos, espaço, parênteses, ponto, hífen e o "+".
const TYPED = /^\+?[\d\s().-]+$/;

// Telefone como a pessoa digita ("(11) 98765-4321", "+55 11 98765-4321", "+1 415 555 2671")
// vira E.164, ou null se não for um número válido. Sem "+", 10 ou 11 dígitos são um número do
// Brasil sem DDI e ganham o 55; com mais dígitos, o DDI já está no começo.
export function normalizePhone(value: string): string | null {
  const typed = value.trim();
  if (!TYPED.test(typed)) return null;
  const digits = typed.replace(/\D/g, "");
  const national = !typed.startsWith("+") && (digits.length === 10 || digits.length === 11);
  const full = national ? `${BR_DDI}${digits}` : digits;
  if (!E164.test(`+${full}`)) return null;
  if (full.startsWith(BR_DDI) && !BR_NATIONAL.test(full.slice(BR_DDI.length))) return null;
  return `+${full}`;
}

// Já está na forma que normalizePhone devolve (é o que o banco guarda).
export const isNormalizedPhone = (value: string): boolean => normalizePhone(value) === value;

// "+5511987654321" → "(11) 98765-4321"; número de fora do Brasil fica em E.164.
export function formatPhone(phone: string): string {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}
