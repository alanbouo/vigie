import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  runChatDiagnostic,
  resolveProvider,
  type SiteDigest,
} from "@vigie/diagnostic";

const digest: SiteDigest = {
  url: "https://exemple.fr",
  robots: {
    blocksSearch: false,
    aiCrawlersBlocked: { GPTBot: true, ClaudeBot: false, PerplexityBot: false, "Google-Extended": false },
    raw: "User-agent: GPTBot\nDisallow: /",
  },
  llmsTxt: { present: false, valid: false },
  sitemap: { ok: true, urlCount: 12 },
  ssl: { daysRemaining: 60 },
  pages: [
    {
      url: "https://exemple.fr",
      statusCode: 200,
      noindex: false,
      canonical: "https://exemple.fr",
      title: "Exemple",
      h1: null,
      metaDescription: null,
      structuredDataTypes: [],
      structuredDataValid: true,
      redirectChain: [],
      textLength: 1200,
      clickDepth: 0,
      extrait: "",
    },
  ],
};

const validOutput = {
  site: "https://exemple.fr",
  profondeur: "quick",
  resume: "Le site est globalement sain mais bloque GPTBot et manque de balisage sur la home.",
  findings: [
    {
      signal: "ai_crawler_blocked",
      severite: "critique",
      pilier: "geo",
      urls: ["https://exemple.fr"],
      explication: "Le robots.txt interdit l'accès à GPTBot : le site est invisible pour ChatGPT.",
      correctif: "Retirer la règle Disallow visant GPTBot dans robots.txt.",
      effort: 1,
    },
  ],
};

function fakeFetch(responses: string[]): typeof fetch {
  let call = 0;
  return (async () => {
    const content = responses[Math.min(call, responses.length - 1)];
    call++;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
}

const provider = resolveProvider({
  provider: "xai",
  xaiApiKey: "test-key",
  llmCostPerMTokInputUsd: 3,
  llmCostPerMTokOutputUsd: 15,
});

async function outDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "vigie-diag-"));
}

describe("runner chat (xAI / OpenAI-compatible)", () => {
  it("produit findings.json + rapport.md conformes au contrat commun", async () => {
    const dir = await outDir();
    const result = await runChatDiagnostic(
      { url: "https://exemple.fr", profondeur: "quick", workspaceDir: ".", outputDir: dir },
      provider,
      { digest, fetchImpl: fakeFetch([JSON.stringify(validOutput), "# Rapport\n\nSynthèse."]) }
    );
    expect(result.ok).toBe(true);
    expect(result.output?.findings[0].signal).toBe("ai_crawler_blocked");
    expect(result.rapportMarkdown).toContain("# Rapport");

    const onDisk = JSON.parse(await readFile(path.join(dir, "findings.json"), "utf-8"));
    expect(onDisk.site).toBe("https://exemple.fr");
    // Instrumentation des coûts : 2 appels × (1000 in + 500 out) aux tarifs configurés.
    expect(result.cout.inputTokens).toBe(2000);
    expect(result.cout.outputTokens).toBe(1000);
    expect(result.cout.totalCostUsd).toBeCloseTo((2000 / 1e6) * 3 + (1000 / 1e6) * 15, 6);
  });

  it("retry quand le JSON est invalide, puis succès", async () => {
    const dir = await outDir();
    const result = await runChatDiagnostic(
      { url: "https://exemple.fr", profondeur: "quick", workspaceDir: ".", outputDir: dir },
      provider,
      {
        digest,
        fetchImpl: fakeFetch([
          "pas du json",
          JSON.stringify({ site: "pas-une-url" }),
          JSON.stringify(validOutput),
          "# Rapport",
        ]),
      }
    );
    expect(result.ok).toBe(true);
    expect(result.cout.numTurns).toBe(4); // 3 tentatives findings + 1 rapport
  });

  it("échoue proprement après épuisement des retries", async () => {
    const dir = await outDir();
    const result = await runChatDiagnostic(
      {
        url: "https://exemple.fr",
        profondeur: "quick",
        workspaceDir: ".",
        outputDir: dir,
        maxJsonRetries: 1,
      },
      provider,
      { digest, fetchImpl: fakeFetch(["toujours pas du json"]) }
    );
    expect(result.ok).toBe(false);
    expect(result.erreur).toContain("2 tentatives");
  });
});
