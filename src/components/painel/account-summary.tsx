import { getCurrentProfile } from "@/server/auth/current-profile";

// Nome do negócio e e-mail do dono no cabeçalho. Lê a sessão: fica atrás de um <Suspense>.
export async function AccountSummary() {
  const { user, tenant } = await getCurrentProfile();
  return (
    <div className="hidden min-w-0 flex-col items-end text-right sm:flex">
      <span className="max-w-[24ch] truncate text-label text-ink">{tenant.name}</span>
      <span className="max-w-[28ch] truncate text-micro text-ink-2">{user.email}</span>
    </div>
  );
}

export function AccountSummarySkeleton() {
  return (
    <div aria-hidden="true" className="hidden flex-col items-end gap-1.5 sm:flex">
      <span className="h-4 w-32 animate-pulse rounded-sheet bg-tint" />
      <span className="h-3 w-40 animate-pulse rounded-sheet bg-tint" />
    </div>
  );
}
