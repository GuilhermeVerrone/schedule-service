import { NextResponse } from "next/server";
import { publicSiteDto } from "@/server/http/serializers";
import { PUBLIC_NOT_FOUND, publicRoute } from "@/server/http/public-route";
import { found } from "@/server/http/tenant-route";
import { createPublicRepository } from "@/server/repositories/public-repository";

// GET /api/public/:slug: dados do mini-site (D2). Negócio, serviços e profissionais ativos e
// vinculados entre si; nada de clientes, agendamentos ou tenantId.
export const GET = publicRoute<{ slug: string }>("read", async ({ params }) => {
  const site = found(await createPublicRepository().getSite(params.slug), PUBLIC_NOT_FOUND.business);
  return NextResponse.json(publicSiteDto(site));
});
