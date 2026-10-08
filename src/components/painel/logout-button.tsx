"use client";

import { Loader2Icon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LOGGED_OUT_PARAM, LOGIN_PATH } from "@/server/auth/redirects";

// Sair (guia 7b): apaga a sessão no banco e o cookie (POST /api/auth/logout) e volta ao login.
// Navegação completa de propósito: descarta o cache do roteador, para nenhum trecho do painel
// desta conta reaparecer para quem entrar depois no mesmo navegador. O toast sai no login.
export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(`logout ${response.status}`);
    } catch {
      setPending(false);
      toast.error("Não foi possível sair agora. Tente de novo.");
      return;
    }
    window.location.replace(`${LOGIN_PATH}?${LOGGED_OUT_PARAM}=1`);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleLogout} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <LogOutIcon aria-hidden="true" />}
      Sair
    </Button>
  );
}
