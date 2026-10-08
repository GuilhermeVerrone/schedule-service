// IP do cliente para o limite de tentativas. Atrás do proxy da hospedagem o primeiro item de
// x-forwarded-for é o cliente; sem cabeçalho cai num balde comum.
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
