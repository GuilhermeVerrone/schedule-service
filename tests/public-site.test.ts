import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tenant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { joinNames } from "@/components/site/site-blocks";
import { config as proxyConfig, publicSiteSlug } from "@/proxy";
import { TENANT_ID_HEADER, USER_ID_HEADER } from "@/server/auth/context";
import { currentSitePage, SITE_NAV, sitePath, telHref } from "@/components/site/site-nav-items";
import { siteDescription, siteMetadata } from "@/server/public-site/load-site";
import type { PublicSite } from "@/server/repositories/public-repository";
import { apiRequest, throughProxy } from "./helpers/auth";
import { createTestTenant, deleteTestTenants } from "./helpers/tenants";

// Fatia 2, Fase 8: peças puras do site público em /{slug} (menu, página atual, metadados,
// telefone) e o 404 pelo proxy. A navegação no navegador fica no E2E (e2e/public-site.spec.ts).

function site(business: Partial<PublicSite["business"]> = {}): PublicSite {
  return {
    tenantId: "interno",
    business: {
      slug: "studio-bela",
      name: "Studio Bela",
      description: null,
      address: null,
      phone: null,
      timezone: "America/Sao_Paulo",
      slotStepMinutes: 15,
      bufferMinutes: 0,
      minAdvanceMinutes: 120,
      maxWindowDays: 60,
      cancelDeadlineMinutes: 120,
      ...business,
    },
    services: [],
    professionals: [],
  };
}

describe("menu do site", () => {
  it("tem Início, Serviços, Equipe e Agendar, nessa ordem, com caminhos sob o slug", () => {
    expect(SITE_NAV.map((item) => item.label)).toEqual(["Início", "Serviços", "Equipe", "Agendar"]);
    expect(sitePath("studio-bela", "inicio")).toBe("/studio-bela");
    expect(sitePath("studio-bela", "servicos")).toBe("/studio-bela/servicos");
    expect(sitePath("studio-bela", "equipe")).toBe("/studio-bela/equipe");
    expect(sitePath("studio-bela", "agendar")).toBe("/studio-bela/agendar");
  });

  it("marca a página atual pelo caminho, sem confundir o Início com as demais", () => {
    expect(currentSitePage("studio-bela", "/studio-bela")).toBe("inicio");
    expect(currentSitePage("studio-bela", "/studio-bela/")).toBe("inicio");
    expect(currentSitePage("studio-bela", "/studio-bela/servicos")).toBe("servicos");
    expect(currentSitePage("studio-bela", "/studio-bela/equipe/")).toBe("equipe");
    expect(currentSitePage("studio-bela", "/studio-bela/servicos-extra")).toBeNull();
    expect(currentSitePage("studio-bela", "/outro/servicos")).toBeNull();
  });
});

describe("metadados", () => {
  it("título com o nome do negócio e a página", () => {
    expect(siteMetadata(site(), "inicio").title).toBe("Studio Bela");
    expect(siteMetadata(site(), "servicos").title).toBe("Serviços · Studio Bela");
    expect(siteMetadata(site(), "equipe").title).toBe("Equipe · Studio Bela");
    expect(siteMetadata(site(), "equipe").openGraph).toMatchObject({ siteName: "Studio Bela", locale: "pt_BR" });
  });

  it("descrição do Início vem do negócio; sem ela, uma frase com o nome", () => {
    expect(siteDescription(site(), "inicio")).toBe("Serviços, equipe e contato de Studio Bela.");
    expect(siteDescription(site({ description: "  Cortes e\n\ncoloração.  " }), "inicio")).toBe("Cortes e coloração.");
  });

  it("descrição longa é cortada numa palavra, até 160 caracteres", () => {
    const long = `${"palavra ".repeat(40)}fim.`;
    const text = siteDescription(site({ description: long }), "inicio");
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text.endsWith("palavra…")).toBe(true);
  });

  it("não expõe dados internos (tenantId, parâmetros da agenda)", () => {
    const serialized = JSON.stringify(siteMetadata(site(), "inicio"));
    expect(serialized).not.toContain("interno");
    expect(serialized).not.toContain("America/Sao_Paulo");
  });
});

describe("telefone e listas", () => {
  it("link tel: só com dígitos, com + quando há DDI escrito", () => {
    expect(telHref("(11) 98765-4321")).toBe("tel:11987654321");
    expect(telHref("+55 11 98765-4321")).toBe("tel:+5511987654321");
    expect(telHref("ramal 12")).toBeNull();
  });

  it("junta nomes em português", () => {
    expect(joinNames(["Ana"])).toBe("Ana");
    expect(joinNames(["Ana", "Bruno"])).toBe("Ana e Bruno");
    expect(joinNames(["Ana", "Bruno", "Carla"])).toBe("Ana, Bruno e Carla");
  });
});

describe("proxy no site público (guia 7f)", () => {
  let tenant: Tenant;
  beforeAll(async () => {
    tenant = await createTestTenant("site");
  });
  afterAll(async () => {
    await deleteTestTenants(tenant);
    await prisma.$disconnect();
  });

  const sitePattern = () => {
    const pattern = proxyConfig.matcher.find((entry) => entry.startsWith("/(("));
    return new RegExp(`^${pattern}$`);
  };

  it("o matcher pega os caminhos do site e deixa de fora o app e os arquivos", () => {
    const site = sitePattern();
    for (const path of ["/studio-bela", "/studio-bela/servicos", "/studio-bela/equipe", "/apis", "/painel-x", "/logins"]) {
      expect(site.test(path), path).toBe(true);
    }
    for (const path of ["/", "/api", "/api/public/x", "/painel", "/painel/agenda", "/login", "/cadastro", "/_next/static/a.js", "/favicon.ico"]) {
      expect(site.test(path), path).toBe(false);
    }
    expect(proxyConfig.matcher).toEqual(expect.arrayContaining(["/api/:path*", "/painel/:path*", "/login", "/cadastro"]));
  });

  it("extrai o slug só de caminhos do site", () => {
    expect(publicSiteSlug("/studio-bela")).toBe("studio-bela");
    expect(publicSiteSlug("/studio-bela/servicos/")).toBe("studio-bela");
    expect(publicSiteSlug("/")).toBeNull();
    expect(publicSiteSlug("/painel/agenda")).toBeNull();
    expect(publicSiteSlug("/robots.txt")).toBeNull();
  });

  it.each(["/nao-existe-slotz", "/nao-existe-slotz/servicos", "/admin", "/login-x/equipe", "/Maiusculo"])(
    "slug inexistente, reservado ou inválido: %s responde 404 já no proxy",
    async (path) => {
      const { proxyResponse, forwarded } = await throughProxy(apiRequest(path));
      expect(forwarded).toBeNull();
      expect(proxyResponse.status).toBe(404);
      expect(proxyResponse.headers.get("x-middleware-rewrite")).toContain("/_slotz/nao-encontrado");
    },
  );

  it("slug existente segue para a página sem tenantId nem userId, mesmo com cabeçalhos forjados", async () => {
    for (const page of ["", "/servicos", "/equipe"]) {
      const { proxyResponse, forwarded } = await throughProxy(
        apiRequest(`/${tenant.slug}${page}`, {
          cookie: "token-qualquer",
          headers: { [TENANT_ID_HEADER]: "forjado", [USER_ID_HEADER]: "forjado" },
        }),
      );
      expect(proxyResponse.status).toBe(200);
      expect(forwarded).not.toBeNull();
      expect(forwarded!.headers.get(TENANT_ID_HEADER)).toBeNull();
      expect(forwarded!.headers.get(USER_ID_HEADER)).toBeNull();
      // Não lê nem apaga o cookie de sessão nas páginas do site.
      expect(proxyResponse.headers.get("set-cookie")).toBeNull();
    }
  });
});
