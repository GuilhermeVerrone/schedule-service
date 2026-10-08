"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResult } from "./api-client";

// Carga de dados de uma tela: estados carregando / erro / pronto (D7) e "Tentar de novo".
// `setData` aplica as mudanças locais depois de cada gravação, sem buscar tudo de novo.

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | { status: "ready"; data: T };

export function useResource<T>(load: () => Promise<ApiResult<T>>) {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  // A função de carga é fixa enquanto a tela está montada (outro [id] monta outra tela).
  const [loader] = useState(() => load);

  const reload = useCallback(async () => {
    setState({ status: "loading" });
    const result = await loader();
    setState(result.ok ? { status: "ready", data: result.data } : { status: "error", code: result.code, message: result.message });
  }, [loader]);

  useEffect(() => {
    // Carga inicial ao montar a tela.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const setData = useCallback((update: (current: T) => T) => {
    setState((current) => (current.status === "ready" ? { status: "ready", data: update(current.data) } : current));
  }, []);

  return { state, reload, setData };
}
