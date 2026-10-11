import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Página não encontrada · Slotz" };

// 404 de todo o app: endereço que não existe e site de negócio com slug inexistente ou
// reservado (guia 7f). Não diz se o slug já existiu nem sugere outros negócios.
export default function NotFound() {
  return (
    <main id="conteudo" className="flex flex-1 items-center bg-paper">
      <div className="mx-auto w-full max-w-page px-gutter py-section">
        <p className="font-heading text-title text-numeral-rest tabular-nums">404</p>
        <h1 className="mt-4 max-w-[18ch] text-headline text-ink">Página não encontrada</h1>
        <p className="mt-4 max-w-[52ch] text-lead text-ink-2">
          O endereço pode ter sido digitado errado ou não existe mais. Confira o link que você recebeu do negócio.
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-10 w-full sm:w-auto" })}>
          Ir para o Slotz
        </Link>
      </div>
    </main>
  );
}
