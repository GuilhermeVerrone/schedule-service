"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchConnection, type ConnectionDto } from "./whatsapp-api";

// Estado da conexão com polling curto (impacto > Visual): o status muda sem ação do dono (QR
// lido, queda). Com QR na tela, a cada 3 s; nos outros estados, a cada 15 s. Pausa com a aba
// escondida, consulta na hora ao voltar e para de vez ao sair da tela (desmontar).

export const POLL_QR_MS = 3_000;
export const POLL_IDLE_MS = 15_000;

export type ConnectionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  // `stale`: a última consulta de fundo falhou; a tela mantém o que já mostrava.
  | { status: "ready"; data: ConnectionDto; stale: boolean };

export function useConnection() {
  const [state, setState] = useState<ConnectionState>({ status: "loading" });
  const stateRef = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  // Cada consulta e cada ação recebe um número; resposta de consulta mais velha que a última
  // ação é descartada (ex.: um polling que saiu antes do "Desconectar" e volta "conectado").
  const seq = useRef(0);
  // A próxima consulta agendada chama a versão atual de `poll` (que agenda a seguinte).
  const pollRef = useRef<() => Promise<void>>(async () => {});

  const apply = useCallback((next: ConnectionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const current = stateRef.current;
    if (!alive.current || current.status !== "ready" || document.hidden) return;
    timer.current = setTimeout(() => void pollRef.current(), current.data.status === "qr_pending" ? POLL_QR_MS : POLL_IDLE_MS);
  }, []);

  const poll = useCallback(async () => {
    const mine = ++seq.current;
    const result = await fetchConnection();
    if (!alive.current || mine !== seq.current) return;
    const current = stateRef.current;
    if (result.ok) apply({ status: "ready", data: result.data, stale: false });
    else if (current.status === "ready") apply({ ...current, stale: true });
    else apply({ status: "error", message: result.message });
    schedule();
  }, [apply, schedule]);

  // Carga inicial (e "Tentar de novo"): volta ao estado carregando.
  const reload = useCallback(async () => {
    apply({ status: "loading" });
    await poll();
  }, [apply, poll]);

  // Resposta de conectar/reconectar/desconectar: troca o estado e reinicia o relógio do polling.
  const replace = useCallback(
    (data: ConnectionDto) => {
      seq.current += 1;
      apply({ status: "ready", data, stale: false });
      schedule();
    },
    [apply, schedule],
  );

  useEffect(() => {
    pollRef.current = poll;
    alive.current = true;
    // Carga inicial ao montar a tela.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll();
    const onVisibility = () => {
      if (document.hidden) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      } else if (stateRef.current.status === "ready") {
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  return { state, reload, replace, refresh: poll };
}
