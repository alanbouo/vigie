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

  it("xai en mode agent-sdk : endpoint Anthropic-compatible de xAI", () => {
    const p = resolveProvider({ provider: "xai", xaiApiKey: "k" }, undefined, "agent-sdk");
    expect(p.mode).toBe("agent-sdk");
    expect(p.agentBaseUrl).toBe("https://api.x.ai");
    expect(p.model).toBe("grok-4");
  });

  it("le mode serveur (LLM_MODE) s'applique, l'override par job prime", () => {
    const serveur = resolveProvider({ provider: "xai", xaiApiKey: "k", mode: "agent-sdk" });
    expect(serveur.mode).toBe("agent-sdk");
    const job = resolveProvider(
      { provider: "xai", xaiApiKey: "k", mode: "agent-sdk" },
      undefined,
      "chat"
    );
    expect(job.mode).toBe("chat");
  });

  it("openai-compatible refuse le mode agent-sdk (pas de protocole Anthropic garanti)", () => {
    expect(() =>
      resolveProvider(
        {
          provider: "openai-compatible",
          llmApiKey: "k",
          llmBaseUrl: "https://api.exemple.com/v1",
          llmModel: "m",
        },
        undefined,
        "agent-sdk"
      )
    ).toThrow(/ne supporte pas le mode/);
  });

  it("LLM_MODE serveur non supporté par le provider → retombe sur son défaut", () => {
    // Serveur configuré LLM_MODE=chat (pour xai), mais job basculé sur anthropic :
    // pas d'erreur, anthropic retombe sur agent-sdk.
    const p = resolveProvider(
      { provider: "xai", xaiApiKey: "x", anthropicApiKey: "a", mode: "chat" },
      "anthropic"
    );
    expect(p.mode).toBe("agent-sdk");
    // En revanche, un override par job explicitement incompatible → erreur.
    expect(() =>
      resolveProvider({ anthropicApiKey: "a" }, "anthropic", "chat")
    ).toThrow(/ne supporte pas le mode/);
  });

  it("clé manquante → message dédié au provider", () => {
    expect(missingKeyError(resolveProvider({ provider: "xai" }))).toContain("XAI_API_KEY");
    expect(missingKeyError(resolveProvider({}))).toContain("ANTHROPIC_API_KEY");
    expect(missingKeyError(resolveProvider({ provider: "xai", xaiApiKey: "k" }))).toBeNull();
  });
});
