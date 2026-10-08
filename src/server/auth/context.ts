import { z } from "zod";

// O proxy (src/proxy.ts) valida a sessão e injeta estes cabeçalhos na requisição, depois de
// apagar qualquer valor vindo do cliente. Route handlers leem o tenantId só daqui e o passam
// para createTenantRepository(tenantId).

export const TENANT_ID_HEADER = "x-slotz-tenant-id";
export const USER_ID_HEADER = "x-slotz-user-id";

export interface AuthContext {
  tenantId: string;
  userId: string;
}

const idSchema = z.uuid();

export function getAuthContext(headers: Headers): AuthContext | null {
  const tenantId = headers.get(TENANT_ID_HEADER);
  const userId = headers.get(USER_ID_HEADER);
  if (!idSchema.safeParse(tenantId).success || !idSchema.safeParse(userId).success) return null;
  return { tenantId: tenantId!, userId: userId! };
}
