import Link from "next/link";
import { cn } from "@/lib/utils";

// Nome do produto no cabeçalho (o Slotz ainda não tem logo: título em Poppins, como na Fase 1).
export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "-mx-2 rounded-control px-2 py-1 font-heading text-title text-ink no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-violet",
        className,
      )}
    >
      Slotz
    </Link>
  );
}
