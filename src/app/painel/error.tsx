"use client";

import { RotateCcwIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/auth/form-alert";

// Estado de erro do painel: mensagem curta e "Tentar de novo" (sem detalhes técnicos na tela).
export default function PainelError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-page flex-col items-start gap-6 px-gutter py-section">
      <h1 className="text-headline text-ink">Não foi possível carregar o painel</h1>
      <FormAlert message="Pode ter sido uma falha de conexão. Tente de novo em instantes." />
      <Button variant="outline" onClick={() => retry()}>
        <RotateCcwIcon aria-hidden="true" />
        Tentar de novo
      </Button>
    </div>
  );
}
