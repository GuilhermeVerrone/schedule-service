import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workerImportGraph } from "./worker-boundary.test";

// Regra de ouro da fatia (guia 6, 9; impacto "Arquitetura"): nenhuma mensagem sai sem passar pela
// fila. Fora do adapter (onde `sendText` é definido), o único código do produto que chama
// `sendText` é o worker de envio, que roda a elegibilidade e a política antes de cada tentativa.

const root = fileURLToPath(new URL("..", import.meta.url));
const SCANNED_DIRS = ["src", "scripts"];
const IGNORED = ["src/generated/"];
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
// Onde `sendText` pode aparecer: a definição no adapter e a única chamada, no worker.
const ADAPTER_DIR = "src/server/whatsapp/";
const OUTBOUND_WORKER = "src/server/outbound/worker.ts";

// Chamada ou referência: `.sendText(`, `sendText:` desestruturado, `["sendText"]`, `{ sendText }`.
const SEND_TEXT = /sendText/;

const posix = (path: string) => path.split(sep).join("/");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

export function sendTextReferences(file: string, content: string): number[] {
  if (file === OUTBOUND_WORKER || file.startsWith(ADAPTER_DIR) || IGNORED.some((dir) => file.startsWith(dir))) {
    return [];
  }
  return content.split("\n").flatMap((line, index) => {
    if (/^\s*(\/\/|\/?\*)/.test(line)) return []; // comentário
    return SEND_TEXT.test(line) ? [index + 1] : [];
  });
}

describe("nenhum sendText fora do worker", () => {
  it("em src/ e scripts/, só o worker de envio (e o próprio adapter) referencia sendText", () => {
    const files = SCANNED_DIRS.flatMap((dir) => listFiles(join(root, dir)))
      .map((path) => posix(relative(root, path)))
      .filter((file) => SOURCE_FILE.test(file));
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(OUTBOUND_WORKER);

    const violations = files.flatMap((file) =>
      sendTextReferences(file, readFileSync(join(root, file), "utf8")).map((line) => `${file}:${line}`),
    );
    expect(violations).toEqual([]);
  });

  it("o worker chama o sendText do adapter (a varredura olha o lugar certo)", () => {
    const content = readFileSync(join(root, OUTBOUND_WORKER), "utf8");
    expect(content).toMatch(/deps\.provider\.sendText\(/);
    expect(content).toMatch(/isContactEligibleForProactive\(/);
    expect(content).toMatch(/evaluateSendPolicy\(/);
  });

  it("o worker de envio está no processo do worker e não alcança o Next", () => {
    const { files } = workerImportGraph(["src/worker/main.ts"]);
    expect(files).toContain(OUTBOUND_WORKER);
    expect(files).toContain("src/server/outbound/eligibility.ts");
    expect(files).toContain("src/server/outbound/send-policy.ts");
  });

  it.each([
    "await getWhatsAppProvider().sendText({ sessionId, to, text });",
    "const { sendText } = provider;",
    'provider["sendText"](input);',
    "await provider.sendText(input)",
  ])("detecta envio direto fora do worker (falha de propósito): %s", (snippet) => {
    expect(sendTextReferences("src/server/agenda/booking.ts", `export {};\n${snippet}\n`)).toEqual([2]);
    expect(sendTextReferences("src/app/api/x/route.ts", snippet)).toEqual([1]);
  });

  it("comentário não conta, e o worker e o adapter são permitidos", () => {
    expect(sendTextReferences("src/server/agenda/booking.ts", "// nunca chamar sendText aqui")).toEqual([]);
    expect(sendTextReferences(OUTBOUND_WORKER, "await deps.provider.sendText(x)")).toEqual([]);
    expect(sendTextReferences(`${ADAPTER_DIR}fake-provider.ts`, "async sendText() {}")).toEqual([]);
  });
});
