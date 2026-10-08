import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

const pillars = [
  {
    numeral: "01",
    name: "Atendimento no WhatsApp",
    problem: "Seus clientes recebem resposta na hora, mesmo quando você está atendendo.",
  },
  {
    numeral: "02",
    name: "Agenda organizada",
    problem: "Serviços, profissionais e horários num lugar só, com link para o cliente marcar.",
  },
  {
    numeral: "03",
    name: "Cobrança sem constrangimento",
    problem: "Pix, cartão ou boleto com baixa automática e lembretes na medida certa.",
  },
];

export default function Home() {
  return (
    <>
      <header className="h-header">
        <div className="mx-auto flex h-full max-w-page items-center justify-between px-gutter">
          <span className="font-heading text-title text-ink">Slotz</span>
          <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Entrar
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-page px-gutter py-section">
          <h1 className="max-w-[15ch] text-display text-ink">
            Seus clientes atendidos, agendados e cobrados pelo WhatsApp
          </h1>
          <p className="mt-6 max-w-[60ch] text-lead text-ink-2">
            O Slotz cuida das conversas, da agenda e dos pagamentos do seu negócio, para você
            focar no atendimento.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/cadastro" className={buttonVariants()}>
              Criar minha conta
            </Link>
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>
              Já tenho conta
            </Link>
          </div>
        </section>

        <section className="bg-surface">
          <ol className="mx-auto max-w-page px-gutter py-section">
            {pillars.map((pillar) => (
              <li
                key={pillar.numeral}
                className="grid grid-cols-[3rem_1fr] gap-x-4 gap-y-1 border-t border-line py-6 last:border-b sm:grid-cols-[4rem_1fr_1.4fr] sm:items-baseline"
              >
                <span className="font-heading text-title text-numeral-rest tabular-nums">
                  {pillar.numeral}
                </span>
                <h2 className="text-title text-ink">{pillar.name}</h2>
                <p className="col-start-2 text-small text-ink-2 sm:col-start-3">
                  {pillar.problem}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="bg-night">
        <div className="mx-auto max-w-page px-gutter py-8 text-micro text-on-dark-2">
          Slotz, um produto Algoritmi.
        </div>
      </footer>
    </>
  );
}
