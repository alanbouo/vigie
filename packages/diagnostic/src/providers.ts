/**
 * Abstraction de provider LLM pour le Diagnostic.
 *
 * Le provider (qui répond) et le mode (comment l'audit est mené) sont
 * indépendants :
 *
 * - mode "agent-sdk" : audit agentique complet via le Claude Agent SDK et le
 *   skill claude-seo (l'agent navigue lui-même, creuse ses hypothèses).
 *   Fonctionne avec Anthropic, et avec xAI via son endpoint compatible
 *   Anthropic (https://api.x.ai — à valider sur sites de test avant de
 *   facturer, le suivi du protocole d'outils dépend du modèle).
 * - mode "chat" : la collecte est faite par notre crawler déterministe, puis
 *   le LLM analyse via /chat/completions (xAI/Grok, OpenAI, endpoint libre).
 *   Coût prévisible, mais le modèle ne voit que le digest du crawler.
 *
 * Le schéma de sortie (§4.2) est identique quels que soient provider et
 * mode : le dashboard, l'historique et le Top 3 ne voient aucune différence.
 */

export type ProviderId = "anthropic" | "xai" | "openai-compatible";
export type RunMode = "agent-sdk" | "chat";

export interface ProviderConfig {
  provider: ProviderId;
  mode: RunMode;
  apiKey: string;
  /** Base URL de l'API /chat/completions pour le mode chat (ex. https://api.x.ai/v1). */
  baseUrl: string;
  /**
   * Base URL du protocole Anthropic pour le mode agent-sdk quand le provider
   * n'est pas Anthropic (ex. https://api.x.ai). Vide = endpoint par défaut du SDK.
   */
  agentBaseUrl: string;
  model: string;
  /** Coûts par million de tokens (instrumentation §10, mode chat). 0 = inconnu. */
  costPerMTokInputUsd: number;
  costPerMTokOutputUsd: number;
}

interface ProviderDefaults {
  defaultMode: RunMode;
  supportedModes: RunMode[];
  baseUrl: string;
  agentBaseUrl: string;
  model: string;
}

export const PROVIDER_DEFAULTS: Record<ProviderId, ProviderDefaults> = {
  anthropic: {
    defaultMode: "agent-sdk",
    supportedModes: ["agent-sdk"],
    baseUrl: "https://api.anthropic.com",
    agentBaseUrl: "", // endpoint par défaut du SDK
    model: "", // modèle par défaut du SDK
  },
  xai: {
    // Les deux modes sont disponibles ; chat par défaut (comportement le plus
    // prévisible), agent-sdk en opt-in via LLM_MODE ou par job.
    defaultMode: "chat",
    supportedModes: ["chat", "agent-sdk"],
    baseUrl: "https://api.x.ai/v1",
    agentBaseUrl: "https://api.x.ai",
    model: "grok-4",
  },
  "openai-compatible": {
    defaultMode: "chat",
    supportedModes: ["chat"], // pas de protocole Anthropic garanti
    baseUrl: "",
    agentBaseUrl: "",
    model: "",
  },
};

export interface ProviderEnv {
  provider?: string;
  /** Mode par défaut du serveur (LLM_MODE) ; vide = défaut du provider. */
  mode?: string;
  anthropicApiKey?: string;
  xaiApiKey?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  /** Override de l'endpoint Anthropic-compatible en mode agent (LLM_AGENT_BASE_URL). */
  llmAgentBaseUrl?: string;
  llmModel?: string;
  llmCostPerMTokInputUsd?: number;
  llmCostPerMTokOutputUsd?: number;
}

/**
 * Résout la configuration effective depuis l'environnement.
 * `providerOverride` et `modeOverride` permettent un choix par job
 * (colonnes diagnostics.provider / diagnostics.mode).
 */
export function resolveProvider(
  env: ProviderEnv,
  providerOverride?: string,
  modeOverride?: string
): ProviderConfig {
  const id = (providerOverride ?? env.provider ?? "anthropic") as ProviderId;
  if (!(id in PROVIDER_DEFAULTS)) {
    throw new Error(
      `Provider LLM inconnu : ${id} (attendu : anthropic, xai, openai-compatible)`
    );
  }
  const defaults = PROVIDER_DEFAULTS[id];

  // Le mode serveur (LLM_MODE) est un défaut souple : s'il n'est pas supporté
  // par le provider résolu, on retombe sur le défaut du provider. Seul un
  // override explicite par job est strict (erreur claire).
  let resolvedMode: RunMode;
  if (modeOverride) {
    if (!["agent-sdk", "chat"].includes(modeOverride)) {
      throw new Error(`Mode d'audit inconnu : ${modeOverride} (attendu : agent-sdk, chat)`);
    }
    resolvedMode = modeOverride as RunMode;
    if (!defaults.supportedModes.includes(resolvedMode)) {
      throw new Error(
        `Le provider ${id} ne supporte pas le mode ${resolvedMode} (modes : ${defaults.supportedModes.join(", ")}).`
      );
    }
  } else {
    const envMode = env.mode?.trim() ?? "";
    resolvedMode =
      envMode && defaults.supportedModes.includes(envMode as RunMode)
        ? (envMode as RunMode)
        : defaults.defaultMode;
  }

  const apiKey =
    id === "anthropic"
      ? (env.anthropicApiKey ?? "")
      : id === "xai"
        ? (env.xaiApiKey ?? env.llmApiKey ?? "")
        : (env.llmApiKey ?? "");

  const config: ProviderConfig = {
    provider: id,
    mode: resolvedMode,
    apiKey,
    baseUrl: env.llmBaseUrl?.trim() || defaults.baseUrl,
    agentBaseUrl: env.llmAgentBaseUrl?.trim() || defaults.agentBaseUrl,
    model: env.llmModel?.trim() || defaults.model,
    costPerMTokInputUsd: env.llmCostPerMTokInputUsd ?? 0,
    costPerMTokOutputUsd: env.llmCostPerMTokOutputUsd ?? 0,
  };

  if (id === "openai-compatible" && (!config.baseUrl || !config.model)) {
    throw new Error(
      "Provider openai-compatible : LLM_BASE_URL et LLM_MODEL sont requis."
    );
  }
  return config;
}

export function missingKeyError(config: ProviderConfig): string | null {
  if (config.apiKey) return null;
  switch (config.provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY absent : worker Diagnostic non configuré.";
    case "xai":
      return "XAI_API_KEY absent : provider xAI non configuré.";
    default:
      return "LLM_API_KEY absent : provider LLM non configuré.";
  }
}
