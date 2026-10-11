import { connection, NextResponse } from "next/server";
import { checkRedis } from "@/server/queue/connection";

// GET /api/health: saúde do app para o healthcheck do Compose (D2). Público (src/proxy.ts), sem
// sessão e sem banco. Confere o Redis das filas (D1): fora do ar vira 503 visível (D12), sem
// detalhes de conexão na resposta.
export async function GET(): Promise<NextResponse> {
  await connection(); // sempre na hora do pedido, nunca pré-renderizada no build
  const redis = await checkRedis();
  const ok = redis.status === "up";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks: { redis: redis.status } },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
