import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { crawlSite, type CrawlResult } from "@vigie/garde";
import {
  DiagnosticOutputSchema,
  OUTPUT_SCHEMA_FOR_PROMPT,
  type DiagnosticOutput,
} from "./schema.js";
import type { ProviderConfig } from "./providers.js";
import type { DiagnosticJobConfig, DiagnosticRunResult } from "./runner.js";

/**
 * Runner « chat » : Diagnostic via un LLM compatible /chat/completions
 * (xAI/Grok, OpenAI, …). La collecte est faite par notre crawler
 * déterministe ; le LLM analyse et restitue dans le même schéma que le
 * runner Agent SDK — même contrat de sortie (rapport.md + findings.json).
 */

export interface SiteDigest {
  url: string;
  robots: {
    blocksSearch: boolean;
    aiCrawlersBlocked: Record<string, boolean>;
    raw: string | null;
  };
  llmsTxt: { present: boolean; valid: boolean };
  sitemap: { ok: boolean; urlCount: number };
  ssl: { daysRemaining: number | null };
  pages: {
    url: string;
    statusCode: number;
    noindex: boolean;
    canonical: string | null;
    title: string | null;
    h1: string | null;
    metaDescription: string | null;
    structuredDataTypes: string[];
    structuredDataValid: boolean;
    redirectChain: string[];
    textLength: number;
    clickDepth: number;
    extrait: string;
  }[];
}

const MAX_ROBOTS_CHARS = 2_000;

export function buildSiteDigest(url: string, crawl: CrawlResult): SiteDigest {
  return {
    url,
    robots: {
      blocksSearch: crawl.site.robots.blocksSearch,
      aiCrawlersBlocked: crawl.site.robots.aiCrawlersBlocked,
      raw: crawl.site.robots.raw?.slice(0, MAX_ROBOTS_CHARS) ?? null,
    },
    llmsTxt: crawl.site.llmsTxt,
    sitemap: { ok: crawl.site.sitemap.ok, urlCount: crawl.site.sitemap.urlCount },
    ssl: { daysRemaining: crawl.site.ssl.daysRemaining },
    pages: crawl.pages.map((p) => ({
      url: p.url,
      statusCode: p.statusCode,
      noindex: p.noindex,
      canonical: p.canonical,
      title: p.title,
      h1: p.h1,
      metaDescription: p.metaDescription,
      structuredDataTypes: p.structuredData.types,
      structuredDataValid: p.structuredData.valid,
      redirectChain: p.redirectChain,
      textLength: p.textLength,
      clickDepth: p.clickDepth,
      extrait: "",
    })),
  };
}

interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

async function chatCompletion(
  provider: ProviderConfig,
  messages: { role: "system" | "user"; content: string }[],
  opts: { json: boolean; fetchImpl?: typeof fetch }
): Promise<{ content: string; usage: ChatUsage }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM ${provider.provider} : HTTP ${res.status} — ${(await res.text()).slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`LLM ${provider.provider} : réponse sans contenu.`);
  }
  return {
    content,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

const SYSTEM_PROMPT = `Tu es un expert SEO + GEO/AEO senior. Tu analyses des données de crawl
brutes et tu produis des diagnostics actionnables pour des clients non
techniques, en français, sans jargon inutile. Chaque constat : une cause,
un impact, un correctif concret. Tu regroupes par cause (jamais une ligne
par page).`;

function findingsPrompt(digest: SiteDigest, profondeur: "quick" | "full"): string {
  return `Voici les données de crawl du site ${digest.url} (profondeur ${profondeur}) :

${JSON.stringify(digest, null, 1)}

Analyse ces données : indexabilité (noindex, canonical, robots, sitemap),
accessibilité aux crawlers IA (GPTBot, ClaudeBot, PerplexityBot,
Google-Extended, llms.txt), balisage (title, h1, meta descriptions,
unicité), données structurées, redirections, SSL, maillage (profondeur de
clic), contenu accessible sans JavaScript (textLength faible = suspect).

Réponds UNIQUEMENT avec un objet JSON strictement conforme à ce schéma
(aucun texte autour) :
${OUTPUT_SCHEMA_FOR_PROMPT}

Contraintes :
- "site" = "${digest.url}", "profondeur" = "${profondeur}".
- "signal" : utilise la taxonomie fournie quand elle correspond ; ne force
  pas un signal qui ne correspond pas.
- Maximum 40 findings, regroupés par cause.`;
}

function rapportPrompt(digest: SiteDigest, output: DiagnosticOutput): string {
  return `À partir de ces constats validés sur ${digest.url} :

${JSON.stringify(output, null, 1)}

Rédige le rapport complet en Markdown, destiné au client final (non
technique), en français. Structure : # Synthèse, ## Constats par thème
(indexabilité, visibilité IA, balisage, technique), ## Plan d'action
priorisé (tableau : action, impact attendu, effort). Le rapport sera
re-brandé (white-label) : ne signe pas, ne mentionne aucun outil.
Réponds uniquement avec le Markdown du rapport.`;
}

export interface ChatRunOptions {
  /** Digest pré-construit (tests) ; sinon le crawler collecte les données. */
  digest?: SiteDigest;
  fetchImpl?: typeof fetch;
}

export async function runChatDiagnostic(
  config: DiagnosticJobConfig,
  provider: ProviderConfig,
  opts: ChatRunOptions = {}
): Promise<DiagnosticRunResult> {
  const started = Date.now();
  const cout = {
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    numTurns: 0,
  };
  const addUsage = (u: ChatUsage) => {
    cout.inputTokens += u.inputTokens;
    cout.outputTokens += u.outputTokens;
    cout.numTurns += 1;
    cout.totalCostUsd +=
      (u.inputTokens / 1_000_000) * provider.costPerMTokInputUsd +
      (u.outputTokens / 1_000_000) * provider.costPerMTokOutputUsd;
  };

  try {
    await mkdir(config.outputDir, { recursive: true });

    // 1. Collecte déterministe (plafonds §9 : quick 8 pages, full 60).
    const digest =
      opts.digest ??
      buildSiteDigest(
        config.url,
        await crawlSite({
          siteUrl: config.url,
          maxPages:
            config.profondeur === "quick"
              ? (config.maxPagesQuick ?? 8)
              : (config.maxPagesFull ?? 60),
        })
      );

    // 2. Findings JSON, validés par schéma avec retry (§4.2).
    const maxRetries = config.maxJsonRetries ?? 2;
    let output: DiagnosticOutput | null = null;
    let lastError = "";
    const messages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: findingsPrompt(digest, config.profondeur) },
    ];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await chatCompletion(provider, messages, {
        json: true,
        fetchImpl: opts.fetchImpl,
      });
      addUsage(res.usage);
      try {
        const parsed = DiagnosticOutputSchema.safeParse(JSON.parse(res.content));
        if (parsed.success) {
          output = parsed.data;
          break;
        }
        lastError = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      messages.push(
        { role: "user", content: `Ta réponse est invalide : ${lastError}\nRéponds à nouveau, uniquement le JSON strictement conforme au schéma.` }
      );
    }

    if (!output) {
      cout.durationMs = Date.now() - started;
      return {
        ok: false,
        output: null,
        rapportMarkdown: null,
        cout,
        erreur: `findings invalides après ${maxRetries + 1} tentatives : ${lastError}`,
      };
    }

    // 3. Rapport lisible.
    const rapport = await chatCompletion(
      provider,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: rapportPrompt(digest, output) },
      ],
      { json: false, fetchImpl: opts.fetchImpl }
    );
    addUsage(rapport.usage);

    await writeFile(
      path.join(config.outputDir, "findings.json"),
      JSON.stringify(output, null, 2)
    );
    await writeFile(path.join(config.outputDir, "rapport.md"), rapport.content);

    cout.durationMs = Date.now() - started;
    return {
      ok: true,
      output,
      rapportMarkdown: rapport.content,
      cout,
      erreur: null,
    };
  } catch (err) {
    cout.durationMs = Date.now() - started;
    return {
      ok: false,
      output: null,
      rapportMarkdown: null,
      cout,
      erreur: err instanceof Error ? err.message : String(err),
    };
  }
}
