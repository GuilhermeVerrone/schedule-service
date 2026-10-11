import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// O worker roda fora do Next (D2, impacto "Infraestrutura"): nada do que ele importa, direta ou
// indiretamente, pode depender de contexto de request (next/headers, cookies, sessão) nem do Next.

const root = fileURLToPath(new URL("..", import.meta.url));
const ENTRIES = ["src/worker/main.ts", "src/worker/healthcheck.ts"];
const FORBIDDEN = [/^next(\/|$)/, /^server-only$/, /^react(-dom)?(\/|$)/];

const IMPORT = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(root, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  throw new Error(`import não resolvido: ${spec} em ${relative(root, from)}`);
}

export function workerImportGraph(entries: string[]): { files: string[]; packages: Map<string, string> } {
  const seen = new Set<string>();
  const packages = new Map<string, string>();
  const queue = entries.map((entry) => join(root, entry));
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = match[1] ?? match[2] ?? match[3];
      const local = resolveLocal(file, spec);
      if (local) queue.push(local);
      else packages.set(spec, relative(root, file));
    }
  }
  return { files: [...seen].map((file) => relative(root, file)), packages };
}

describe("fronteira do worker", () => {
  it("o grafo de imports do worker não alcança o Next nem contexto de request", () => {
    const { files, packages } = workerImportGraph(ENTRIES);
    expect(files).toContain("src/server/queue/connection.ts");
    expect(packages.has("bullmq")).toBe(true);
    const violations = [...packages].filter(([spec]) => FORBIDDEN.some((rule) => rule.test(spec)));
    expect(violations).toEqual([]);
  });

  it("a varredura enxerga um import proibido (rota do app importa next/server)", () => {
    const { packages } = workerImportGraph(["src/app/api/health/route.ts"]);
    expect(packages.get("next/server")).toBe("src/app/api/health/route.ts");
  });
});
