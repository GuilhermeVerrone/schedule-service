"use client";

import { useEffect, useRef } from "react";

// Consulta de fundo das telas de conversas: mensagens novas chegam pelo webhook, sem ação do
// dono. A cada `intervalMs` enquanto `enabled`; pausa com a aba escondida, consulta na hora ao
// voltar e para de vez ao sair da tela (desmontar). Uma consulta por vez.

export const CONVERSATIONS_POLL_MS = 15_000;

export function usePolling(task: () => Promise<void>, enabled: boolean, intervalMs = CONVERSATIONS_POLL_MS) {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    let running = false;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      stop();
      if (alive && !document.hidden) timer = setTimeout(() => void run(), intervalMs);
    };
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await taskRef.current();
      } finally {
        running = false;
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else void run();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs]);
}
