import "dotenv/config";
import { defineConfig } from "prisma/config";

// CLI (migrate, db pull etc.) usa a conexão direta; o app usa a pooled via adapter (src/lib/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"],
  },
});
