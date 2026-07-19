import { readFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { DiagnosticOutputSchema, OUTPUT_SCHEMA_FOR_PROMPT, type DiagnosticOutput } from "./schema.js";
import type { ProviderConfig } from "./providers.js";
import { runChatDiagnostic } from "./chatRunner.js";

/**
 * Le Diagnostic (§4) : 1 audit = 1 job asynchrone dans un conteneur éphémère.
 * Worker Claude Agent SDK, cwd = workspace pré-provisionné contenant
 * .claude/skills/claude-seo (fork pinné, licence MIT, attribution conservée).
 */

export interface DiagnosticJobConfig {
  url: string;
  profondeur: "quick" | "full";
  /** Workspace contenant .claude/skills/claude-seo. */
  workspaceDir: string;
  /** Dossier de sortie (rapport.md + findings.json) — seul dossier en écriture. */
  outputDir: string;
  /** Plafonds appliqués dans le code (§9). */
  maxTurns?: number;
  maxPagesQuick?: number;
  maxPagesFull?: number;
  /** Nombre max de tentatives de réparation du JSON invalide. */
  maxJsonRetries?: number;
}

export interface DiagnosticRunResult {
  ok: boolean;
  output: DiagnosticOutput | null;
  rapportMarkdown: string | null;
  /** Instrumentation des coûts dès J1 (§4.3) : ne facturer que les jobs aboutis. */
  cout: {
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    numTurns: number;
  };
  erreur: string | null;
}

const DEFAULTS = {
  maxTurns: 80,
  maxPagesQuick: 8,
  maxPagesFull: 60,
  maxJsonRetries: 2,
};

function buildPrompt(config: DiagnosticJobConfig): string {
  const maxPages =
    config.profondeur === "quick"
      ? (config.maxPagesQuick ?? DEFAULTS.maxPagesQuick)
      : (config.maxPagesFull ?? DEFAULTS.maxPagesFull);

  return `Tu réalises un Diagnostic de santé SEO + GEO/AEO du site ${config.url}.

Utilise le skill claude-seo disponible dans ce projet pour mener l'audit.

Profondeur : ${config.profondeur === "quick" ? `QUICK — limite-toi aux pages clés (home + pages principales), maximum ${maxPages} pages analysées.` : `FULL — audit complet du site, maximum ${maxPages} pages analysées.`}

Couvre au minimum : indexabilité (robots.txt, noindex, canonical, sitemap), accessibilité aux crawlers IA (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, llms.txt), balisage (title, h1, meta descriptions), données structurées, maillage interne, performance perçue, qualité du contenu pour les moteurs de réponse IA.

Tu dois produire DEUX fichiers dans le dossier ${config.outputDir} :

1. \`rapport.md\` — le rapport complet lisible par un client non technique, en français, structuré (synthèse, constats par thème, plan d'action priorisé). Sans jargon inutile.

2. \`findings.json\` — un JSON STRICTEMENT conforme à ce schéma (aucun texte autour, uniquement le JSON) :
${OUTPUT_SCHEMA_FOR_PROMPT}

Règles pour findings.json :
- "signal" doit utiliser la taxonomie fournie quand elle correspond ; sinon garde le constat dans le rapport mais pas dans le JSON.
- Chaque finding : une cause, un impact, un correctif concret.
- Pas plus de 40 findings : regroupe par cause.
- "profondeur" = "${config.profondeur}".
- "site" = "${config.url}".`;
}

/**
 * Variables d'environnement du sous-processus Agent SDK selon le provider.
 * Pour xAI, on pointe le protocole Anthropic vers son endpoint compatible
 * (agentBaseUrl) avec la clé xAI — le reste du process env est conservé.
 */
function agentEnv(provider?: ProviderConfig): Record<string, string> | undefined {
  if (!provider || provider.provider === "anthropic") return undefined;
  const base = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
  );
  return {
    ...base,
    ANTHROPIC_BASE_URL: provider.agentBaseUrl,
    ANTHROPIC_API_KEY: provider.apiKey,
  };
}

async function runQuery(
  prompt: string,
  config: DiagnosticJobConfig,
  provider?: ProviderConfig
): Promise<{ costUsd: number; inputTokens: number; outputTokens: number; numTurns: number }> {
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let numTurns = 0;

  const stream = query({
    prompt,
    options: {
      cwd: config.workspaceDir,
      // Charge .claude/skills/ du workspace (skill claude-seo pinné).
      settingSources: ["project"],
      // Outils restreints (§4.1) : lecture, web, écriture vers la sortie uniquement.
      allowedTools: ["Skill", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Write", "Bash"],
      permissionMode: "acceptEdits",
      maxTurns: config.maxTurns ?? DEFAULTS.maxTurns,
      // Provider non-Anthropic en mode agentique : modèle + endpoint dédiés.
      ...(provider?.model ? { model: provider.model } : {}),
      ...(agentEnv(provider) ? { env: agentEnv(provider) } : {}),
    },
  });

  for await (const message of stream) {
    if (message.type === "result") {
      numTurns = "num_turns" in message ? message.num_turns : 0;
      if ("total_cost_usd" in message && typeof message.total_cost_usd === "number") {
        costUsd = message.total_cost_usd;
      }
      if ("usage" in message && message.usage) {
        const usage = message.usage as { input_tokens?: number; output_tokens?: number };
        inputTokens = usage.input_tokens ?? 0;
        outputTokens = usage.output_tokens ?? 0;
      }
      if (message.subtype !== "success") {
        throw new Error(`Le run s'est terminé en erreur : ${message.subtype}`);
      }
    }
  }
  return { costUsd, inputTokens, outputTokens, numTurns };
}

/**
 * Point d'entrée du Diagnostic. Le provider et le mode sont indépendants :
 * - mode "agent-sdk" : audit agentique (Claude Agent SDK + skill claude-seo),
 *   avec Anthropic ou avec xAI via son endpoint compatible Anthropic ;
 * - mode "chat" : collecte par notre crawler, analyse via /chat/completions.
 * Même schéma de sortie dans tous les cas.
 */
export async function runDiagnostic(
  config: DiagnosticJobConfig,
  provider?: ProviderConfig
): Promise<DiagnosticRunResult> {
  if (provider && provider.mode === "chat") {
    return runChatDiagnostic(config, provider);
  }
  return runAgentDiagnostic(config, provider);
}

async function runAgentDiagnostic(
  config: DiagnosticJobConfig,
  provider?: ProviderConfig
): Promise<DiagnosticRunResult> {
  const started = Date.now();
  const cout = {
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    numTurns: 0,
  };

  try {
    await mkdir(config.outputDir, { recursive: true });

    const usage = await runQuery(buildPrompt(config), config, provider);
    cout.totalCostUsd += usage.costUsd;
    cout.inputTokens += usage.inputTokens;
    cout.outputTokens += usage.outputTokens;
    cout.numTurns += usage.numTurns;

    // Validation par schéma, avec retry si le JSON est invalide (§4.2).
    const maxRetries = config.maxJsonRetries ?? DEFAULTS.maxJsonRetries;
    let output: DiagnosticOutput | null = null;
    let lastError = "";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const parsed = await tryReadOutput(config.outputDir);
      if (parsed.ok) {
        output = parsed.output;
        break;
      }
      lastError = parsed.error;
      if (attempt === maxRetries) break;
      const repair = await runQuery(
        `Le fichier ${path.join(config.outputDir, "findings.json")} est invalide : ${parsed.error}\n\nRéécris-le pour qu'il soit STRICTEMENT conforme au schéma suivant (uniquement le JSON, aucun texte autour) :\n${OUTPUT_SCHEMA_FOR_PROMPT}`,
        { ...config, maxTurns: 10 },
        provider
      );
      cout.totalCostUsd += repair.costUsd;
      cout.inputTokens += repair.inputTokens;
      cout.outputTokens += repair.outputTokens;
      cout.numTurns += repair.numTurns;
    }

    const rapportMarkdown = await readFile(
      path.join(config.outputDir, "rapport.md"),
      "utf-8"
    ).catch(() => null);

    cout.durationMs = Date.now() - started;
    if (!output) {
      return {
        ok: false,
        output: null,
        rapportMarkdown,
        cout,
        erreur: `findings.json invalide après ${maxRetries + 1} tentatives : ${lastError}`,
      };
    }
    return { ok: true, output, rapportMarkdown, cout, erreur: null };
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

async function tryReadOutput(
  outputDir: string
): Promise<{ ok: true; output: DiagnosticOutput } | { ok: false; error: string }> {
  try {
    const raw = await readFile(path.join(outputDir, "findings.json"), "utf-8");
    const json = JSON.parse(raw);
    const result = DiagnosticOutputSchema.safeParse(json);
    if (!result.success) {
      return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }
    return { ok: true, output: result.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
