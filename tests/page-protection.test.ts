import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { config as proxyConfig } from "@/proxy";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { safeNextPath } from "@/server/auth/redirects";
import { apiRequest, cleanupAuthData, sessionCookieOf, throughProxy, uniqueEmail } from "./helpers/auth";

// Fase 5: proteção das telas pelo proxy. /painel sem sessão vai para /login?next=...;
// /login e /cadastro com sessão vão para /painel. O destino do ?next= só pode ser o painel.

let token: string;
let tenantId: string;
let userId: string;

beforeAll(async () => {
  const response = await registerRoute(
    apiRequest("/api/auth/register", {
      method: "POST",
      body: { businessName: "Studio Telas", email: uniqueEmail("telas"), password: "senha-forte-123" },
    }),
  );
  expect(response.status).toBe(201);
  const body = await response.json();
  token = sessionCookieOf(response)!.value;
  tenantId = body.tenant.id;
  userId = body.user.id;
});

afterAll(async () => {
  await cleanupAuthData();
  await prisma.$disconnect();
});

function locationOf(response: Response): URL | null {
  const location = response.headers.get("location");
  return location ? new URL(location) : null;
}

describe("proxy nas telas", () => {
  it("o matcher cobre /painel (e subpáginas), /login e /cadastro", () => {
    expect(proxyConfig.matcher).toEqual(expect.arrayContaining(["/painel/:path*", "/login", "/cadastro"]));
  });

  it.each(["/painel", "/painel/servicos", "/painel/profissionais/abc/horarios?dia=1"])(
    "sem sessão, %s redireciona para /login com o destino em ?next=",
    async (path) => {
      const { proxyResponse, forwarded } = await throughProxy(apiRequest(path));
      expect(forwarded).toBeNull();
      expect(proxyResponse.status).toBe(307);
      const location = locationOf(proxyResponse)!;
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(path);
    },
  );

  it("token inválido em /painel: redireciona e apaga o cookie", async () => {
    const { proxyResponse } = await throughProxy(apiRequest("/painel", { cookie: "token-inventado" }));
    expect(proxyResponse.status).toBe(307);
    expect(locationOf(proxyResponse)!.pathname).toBe("/login");
    const cookie = sessionCookieOf(proxyResponse);
    expect(cookie?.value).toBe("");
    expect(cookie?.attributes["max-age"]).toBe("0");
  });

  it("cabeçalho de tenant forjado sem sessão não abre o painel", async () => {
    const { proxyResponse, forwarded } = await throughProxy(
      apiRequest("/painel", { headers: { [TENANT_ID_HEADER]: tenantId, [USER_ID_HEADER]: userId } }),
    );
    expect(forwarded).toBeNull();
    expect(proxyResponse.status).toBe(307);
  });

  it("com sessão, /painel passa e recebe tenantId/userId da sessão", async () => {
    const { forwarded } = await throughProxy(apiRequest("/painel", { cookie: token }));
    expect(forwarded).not.toBeNull();
    expect(forwarded!.headers.get(TENANT_ID_HEADER)).toBe(tenantId);
    expect(forwarded!.headers.get(USER_ID_HEADER)).toBe(userId);
  });

  it.each(["/login", "/cadastro", "/login/"])("com sessão, %s redireciona para /painel", async (path) => {
    const { proxyResponse, forwarded } = await throughProxy(apiRequest(path, { cookie: token }));
    expect(forwarded).toBeNull();
    expect(proxyResponse.status).toBe(307);
    expect(locationOf(proxyResponse)!.pathname).toBe("/painel");
  });

  it.each(["/login", "/cadastro"])("sem sessão, %s abre normalmente", async (path) => {
    const { forwarded } = await throughProxy(apiRequest(path));
    expect(forwarded).not.toBeNull();
  });

  it("depois do logout, o mesmo cookie volta a ser mandado para o login", async () => {
    const response = await registerRoute(
      apiRequest("/api/auth/register", {
        method: "POST",
        body: { businessName: "Studio Saída", email: uniqueEmail("telas"), password: "senha-forte-123" },
      }),
    );
    const own = sessionCookieOf(response)!.value;
    expect((await throughProxy(apiRequest("/painel", { cookie: own }))).forwarded).not.toBeNull();
    expect((await logoutRoute(apiRequest("/api/auth/logout", { method: "POST", cookie: own }))).status).toBe(204);
    const { proxyResponse } = await throughProxy(apiRequest("/painel", { cookie: own }));
    expect(proxyResponse.status).toBe(307);
    expect(locationOf(proxyResponse)!.pathname).toBe("/login");
  });
});

describe("safeNextPath (destino depois do login)", () => {
  it.each([
    ["/painel", "/painel"],
    ["/painel/servicos", "/painel/servicos"],
    ["/painel/profissionais/1/horarios?dia=2#x", "/painel/profissionais/1/horarios?dia=2#x"],
  ])("aceita %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    null,
    "",
    "painel",
    "/",
    "/login",
    "/painelfalso",
    "//evil.example/painel",
    "/\\evil.example",
    "https://evil.example/painel",
    "/painel/../api/auth/session",
    "javascript:alert(1)",
  ])("recusa %s e volta para /painel", (input) => {
    expect(safeNextPath(input)).toBe("/painel");
  });
});
