import { hash, verify } from "@node-rs/argon2";

// argon2id com os padrões da biblioteca (m=19456 KiB, t=2, p=1, recomendação da OWASP).

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

// Quando o e-mail não existe, verifica contra um hash descartável para o tempo de resposta
// não revelar se a conta existe (premissa e).
export async function burnPasswordCheck(password: string): Promise<false> {
  dummyHash ??= hash("slotz-conta-inexistente");
  await verifyPassword(await dummyHash, password);
  return false;
}
