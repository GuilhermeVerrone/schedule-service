import { apiRequest, throughProxy } from "./auth";

// Chama route handlers como o Next: proxy de verdade primeiro (sessão no banco, tenantId
// injetado) e, se ele deixa passar, o handler do método com os params da URL.

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof HTTP_METHODS)[number];
type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
export type RouteModule = Partial<Record<Method, RouteHandler>>;

export interface CallOptions {
  token?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export function createRouteCaller(routes: Record<string, RouteModule>) {
  function matchRoute(pathname: string): { pattern: string; params: Record<string, string> } {
    for (const pattern of Object.keys(routes)) {
      const names: string[] = [];
      const regex = new RegExp(
        `^${pattern.replace(/\[(\w+)\]/g, (_, name: string) => (names.push(name), "([^/]+)"))}$`,
      );
      const match = regex.exec(pathname);
      if (match) return { pattern, params: Object.fromEntries(names.map((name, i) => [name, match[i + 1]])) };
    }
    throw new Error(`Rota não mapeada no teste: ${pathname}`);
  }

  async function call(method: Method, path: string, options: CallOptions = {}) {
    const { pattern, params } = matchRoute(new URL(path, "http://localhost").pathname);
    const handler = routes[pattern][method];
    if (!handler) throw new Error(`${method} ${pattern} não existe`);
    const { proxyResponse, forwarded } = await throughProxy(
      apiRequest(path, {
        method,
        body: options.body,
        rawBody: options.rawBody,
        cookie: options.token,
        headers: options.headers,
      }),
    );
    const response = forwarded ? await handler(forwarded, { params: Promise.resolve(params) }) : proxyResponse;
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      headers: response.headers,
      reachedHandler: forwarded !== null,
      forwardedHeaders: forwarded?.headers ?? null,
    };
  }

  return { matchRoute, call };
}
