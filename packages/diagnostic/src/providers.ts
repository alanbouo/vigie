/**
 * Abstraction de provider LLM pour le Diagnostic.
 *
 * Deux modes d'exécution :
 * - "agent-sdk" (Anthropic) : audit agentique complet via le Claude Agent SDK
 *   et le skill claude-seo (navigation autonome, WebFetch, etc.).
 * - "chat" (xAI/Grok, OpenAI, ou tout endpoint compatible /chat/completions) :
 *   la collecte de données est faite par notre crawler déterministe, puis le
 *   LLM analyse et produit rapport + findings validés par le même schéma.
 *
 * Le schéma de sortie (§4.2) est identique quel que soit le provider : le
 * dashboard, l'historique et le Top 3 ne voient aucune différence.
 */

export type ProviderId = "anthropic" | "xai" | "openai-compatible";

export interface ProviderConfig {
  provider: ProviderId;
  /** Mode d'exécution : agent complet ou analyse chat sur données crawler. */
  mode: "agent-sdk" | "chat";
  apiKey: string;
  /** Base URL de l'API pour le mode chat (ex. https://api.x.ai/v1). */
  baseUrl: string;
  model: string;
  /** Coûts par million de tokens (instrumentation §10). 0 = inconnu. */
  costPerMTokInputUsd: number;
  costPerMTokOutputUsd: number;
}

export const PROVIDER_DEFAULTS: Record<ProviderId, Partial<ProviderConfig>> = {
  anthropic: {
    mode: "agent-sdk",
    baseUrl: "https://api.anthropic.com",
    model: "", // le modèle par défaut du Agent SDK
  },
  xai: {
    mode: "chat",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4",
  },
  "openai-compatible": {
    mode: "chat",
    baseUrl: "",
    model: "",
  },
};

export interface ProviderEnv {
  provider?: string;
  anthropicApiKey?: string;
  xaiApiKey?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  llmCostPerMTokInputUsd?: number;
  llmCostPerMTokOutputUsd?: number;
}

/**
 * Résout la configuration du provider depuis l'environnement.
 * `override` permet un choix par job (colonne diagnostics.provider).
 */
export function resolveProvider(
  env: ProviderEnv,
  override?: string
): ProviderConfig {
  const id = (override ?? env.provider ?? "anthropic") as ProviderId;
  if (!(id in PROVIDER_DEFAULTS)) {
    throw new Error(
      `Provider LLM inconnu : ${id} (attendu : anthropic, xai, openai-compatible)`
    );
  }
  const defaults = PROVIDER_DEFAULTS[id];

  const apiKey =
    id === "anthropic"
      ? (env.anthropicApiKey ?? "")
      : id === "xai"
        ? (env.xaiApiKey ?? env.llmApiKey ?? "")
        : (env.llmApiKey ?? "");

  const config: ProviderConfig = {
    provider: id,
    mode: defaults.mode!,
    apiKey,
    baseUrl: env.llmBaseUrl?.trim() || defaults.baseUrl || "",
    model: env.llmModel?.trim() || defaults.model || "",
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
