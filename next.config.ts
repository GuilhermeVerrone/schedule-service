import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O link de gestão do agendamento leva o token no caminho (D6): nem Referer, nem cache, nem
  // indexação na página /{slug}/agendamento/{token} e nas rotas da API pública. As rotas também
  // mandam esses cabeçalhos por conta própria (src/server/http/public-route.ts).
  async headers() {
    const noLeak = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/:slug/agendamento/:token", headers: noLeak },
      { source: "/api/public/:path*", headers: noLeak },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
