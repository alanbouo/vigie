import { describe, expect, it } from "vitest";
import { missingKeyError, resolveProvider } from "@vigie/diagnostic";

describe("résolution du provider LLM", () => {
  it("anthropic par défaut, en mode agent-sdk", () => {
    const p = resolveProvider({ anthropicApiKey: "sk-ant" });
    expect(p.provider).toBe("anthropic");
    expect(p.mode).toBe("agent-sdk");
    expect(p.apiKey).toBe("sk-ant");
  });

  it("xai : mode chat, base URL et modèle Grok par défaut", () => {
    const p = resolveProvider({ provider: "xai", xaiApiKey: "xai-key" });
    expect(p.mode).toBe("chat");
    expect(p.baseUrl).toBe("https://api.x.ai/v1");
    expect(p.model).toBe("grok-4");
    expect(p.apiKey).toBe("xai-key");
  });

  it("le modèle et la base URL sont surchargeables par env", () => {
    const p = resolveProvider({
      provider: "xai",
      xaiApiKey: "k",
      llmModel: "grok-4-fast",
      llmBaseUrl: "https://proxy.interne/v1",
    });
    expect(p.model).toBe("grok-4-fast");
    expect(p.baseUrl).toBe("https://proxy.interne/v1");
  });

  it("l'override par job prime sur le défaut serveur", () => {
    const p = resolveProvider(
      { provider: "anthropic", anthropicApiKey: "a", xaiApiKey: "x" },
      "xai"
    );
    expect(p.provider).toBe("xai");
    expect(p.apiKey).toBe("x");
  });

  it("openai-compatible exige base URL + modèle", () => {
    expect(() =>
      resolveProvider({ provider: "openai-compatible", llmApiKey: "k" })
    ).toThrow(/LLM_BASE_URL/);
    const p = resolveProvider({
      provider: "openai-compatible",
      llmApiKey: "k",
      llmBaseUrl: "https://api.exemple.com/v1",
      llmModel: "mon-modele",
    });
    expect(p.mode).toBe("chat");
  });

  it("provider inconnu → erreur claire", () => {
    expect(() => resolveProvider({ provider: "mistral" })).toThrow(/inconnu/);
  });

  it("clé manquante → message dédié au provider", () => {
    expect(missingKeyError(resolveProvider({ provider: "xai" }))).toContain("XAI_API_KEY");
    expect(missingKeyError(resolveProvider({}))).toContain("ANTHROPIC_API_KEY");
    expect(missingKeyError(resolveProvider({ provider: "xai", xaiApiKey: "k" }))).toBeNull();
  });
});
