/**
 * Référentiel des signaux (annexe A de la spec).
 * Taxonomie contrôlée : les trois moteurs (Garde, Diagnostic, Visibilité IA)
 * émettent uniquement des signaux définis ici.
 */

export type Severite = "critique" | "important" | "info";
export type Pilier = "seo" | "geo" | "visibilite";
export type Source = "garde" | "diagnostic" | "visibilite_ia";

export type Famille =
  | "indexabilite"
  | "disponibilite"
  | "performance"
  | "contenu"
  | "maillage"
  | "donnees_structurees"
  | "geo"
  | "visibilite_ia";

export interface SignalDef {
  /** Identifiant stable de la taxonomie. */
  signal: string;
  famille: Famille;
  pilier: Pilier;
  /** 1-10, table de référence pour le scoring (annexe A). */
  impactBase: number;
  severiteDefaut: Severite;
  /**
   * true = confirmation sur 2 crawls requise avant alerte/scoring plein.
   * Les 🔴 francs (noindex, down, SSL, robots bloquant) partent immédiatement.
   */
  confirmationRequise: boolean;
  /** true = alerte email immédiate, hors cycle hebdo. */
  alerteImmediate: boolean;
  /** Effort de correction par défaut (1-5), affinable par finding. */
  effortDefaut: number;
  label: string;
}

export const SIGNALS: Record<string, SignalDef> = {
  // ── 🔴 Critiques ──────────────────────────────────────────────
  noindex_added: {
    signal: "noindex_added",
    famille: "indexabilite",
    pilier: "seo",
    impactBase: 10,
    severiteDefaut: "critique",
    confirmationRequise: false,
    alerteImmediate: true,
    effortDefaut: 1,
    label: "Balise noindex apparue",
  },
  robots_blocking_added: {
    signal: "robots_blocking_added",
    famille: "indexabilite",
    pilier: "seo",
    impactBase: 10,
    severiteDefaut: "critique",
    confirmationRequise: false,
    alerteImmediate: true,
    effortDefaut: 1,
    label: "robots.txt bloquant apparu",
  },
  ai_crawler_blocked: {
    signal: "ai_crawler_blocked",
    famille: "geo",
    pilier: "geo",
    impactBase: 9,
    severiteDefaut: "critique",
    confirmationRequise: false,
    alerteImmediate: true,
    effortDefaut: 1,
    label: "Blocage d'un crawler IA apparu (GPTBot, ClaudeBot, PerplexityBot, Google-Extended)",
  },
  site_down_5xx: {
    signal: "site_down_5xx",
    famille: "disponibilite",
    pilier: "seo",
    impactBase: 10,
    severiteDefaut: "critique",
    confirmationRequise: false,
    alerteImmediate: true,
    effortDefaut: 2,
    label: "Site down / erreurs 5xx",
  },
  ssl_expiring: {
    signal: "ssl_expiring",
    famille: "disponibilite",
    pilier: "seo",
    impactBase: 10,
    severiteDefaut: "critique",
    confirmationRequise: false,
    alerteImmediate: true,
    effortDefaut: 1,
    label: "Certificat SSL expiré ou expirant sous 7 jours",
  },
  canonical_external: {
    signal: "canonical_external",
    famille: "indexabilite",
    pilier: "seo",
    impactBase: 9,
    severiteDefaut: "critique",
    confirmationRequise: true,
    alerteImmediate: true,
    effortDefaut: 2,
    label: "Canonical pointant vers un domaine externe",
  },
  pages_4xx: {
    signal: "pages_4xx",
    famille: "disponibilite",
    pilier: "seo",
    impactBase: 8,
    severiteDefaut: "critique",
    confirmationRequise: true,
    alerteImmediate: true,
    effortDefaut: 2,
    label: "Pages passées en 4xx",
  },
  sitemap_broken: {
    signal: "sitemap_broken",
    famille: "indexabilite",
    pilier: "seo",
    impactBase: 7,
    severiteDefaut: "critique",
    confirmationRequise: true,
    alerteImmediate: true,
    effortDefaut: 1,
    label: "Sitemap cassé (404, vide ou −30 % d'URLs)",
  },

  // ── 🟠 Importants ─────────────────────────────────────────────
  cwv_degraded: {
    signal: "cwv_degraded",
    famille: "performance",
    pilier: "seo",
    impactBase: 6,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 3,
    label: "Core Web Vitals dégradés (seuil franchi ou +30 %)",
  },
  redirect_chain: {
    signal: "redirect_chain",
    famille: "indexabilite",
    pilier: "seo",
    impactBase: 5,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 2,
    label: "Chaînes ou boucles de redirection sur pages clés",
  },
  titles_h1_lost: {
    signal: "titles_h1_lost",
    famille: "contenu",
    pilier: "seo",
    impactBase: 5,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 1,
    label: "Titres ou H1 perdus/dupliqués (≥5 % des pages)",
  },
  content_js_only: {
    signal: "content_js_only",
    famille: "contenu",
    pilier: "seo",
    impactBase: 5,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 4,
    label: "Contenu devenu accessible uniquement via JavaScript",
  },
  structured_data_broken: {
    signal: "structured_data_broken",
    famille: "donnees_structurees",
    pilier: "seo",
    impactBase: 4,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 2,
    label: "Données structurées cassées",
  },
  internal_links_broken: {
    signal: "internal_links_broken",
    famille: "maillage",
    pilier: "seo",
    impactBase: 4,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 2,
    label: "Liens internes cassés (≥5 nouveaux)",
  },
  llmstxt_broken: {
    signal: "llmstxt_broken",
    famille: "geo",
    pilier: "geo",
    impactBase: 3,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 1,
    label: "llms.txt cassé ou disparu",
  },
  duplicate_content: {
    signal: "duplicate_content",
    famille: "contenu",
    pilier: "seo",
    impactBase: 3,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 3,
    label: "Nouveau cluster de contenu dupliqué",
  },
  page_weight_increase: {
    signal: "page_weight_increase",
    famille: "performance",
    pilier: "seo",
    impactBase: 3,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 2,
    label: "Poids de page +50 % ou image >1 Mo",
  },
  meta_description_lost: {
    signal: "meta_description_lost",
    famille: "contenu",
    pilier: "seo",
    impactBase: 2,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 1,
    label: "Meta descriptions perdues (≥10 % des pages)",
  },
  orphan_pages: {
    signal: "orphan_pages",
    famille: "maillage",
    pilier: "seo",
    impactBase: 2,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 2,
    label: "Pages orphelines apparues",
  },

  // ── Visibilité IA (v1.5) ──────────────────────────────────────
  ai_visibility_lost: {
    signal: "ai_visibility_lost",
    famille: "visibilite_ia",
    pilier: "visibilite",
    impactBase: 6,
    severiteDefaut: "important",
    confirmationRequise: true, // bascule confirmée 2 semaines consécutives
    alerteImmediate: false,
    effortDefaut: 3,
    label: "Disparition confirmée des réponses IA / remplacement par un concurrent",
  },
  ai_source_gap: {
    signal: "ai_source_gap",
    famille: "visibilite_ia",
    pilier: "visibilite",
    impactBase: 4,
    severiteDefaut: "important",
    confirmationRequise: true,
    alerteImmediate: false,
    effortDefaut: 3,
    label: "Nouvelle source dominante citée par les IA où le site est absent",
  },

  // ── ⚪ Infos (dashboard uniquement, jamais d'email) ────────────
  new_pages: {
    signal: "new_pages",
    famille: "contenu",
    pilier: "seo",
    impactBase: 1,
    severiteDefaut: "info",
    confirmationRequise: false,
    alerteImmediate: false,
    effortDefaut: 1,
    label: "Nouvelles pages détectées",
  },
  improvement: {
    signal: "improvement",
    famille: "contenu",
    pilier: "seo",
    impactBase: 1,
    severiteDefaut: "info",
    confirmationRequise: false,
    alerteImmediate: false,
    effortDefaut: 1,
    label: "Amélioration détectée",
  },
  minor_change: {
    signal: "minor_change",
    famille: "contenu",
    pilier: "seo",
    impactBase: 1,
    severiteDefaut: "info",
    confirmationRequise: false,
    alerteImmediate: false,
    effortDefaut: 1,
    label: "Variation mineure",
  },
};

export function getSignal(signal: string): SignalDef {
  const def = SIGNALS[signal];
  if (!def) {
    throw new Error(`Signal inconnu dans la taxonomie : ${signal}`);
  }
  return def;
}

export function isKnownSignal(signal: string): boolean {
  return signal in SIGNALS;
}

/** Crawlers IA surveillés dans robots.txt (§3.2). */
export const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
] as const;
export type AiCrawler = (typeof AI_CRAWLERS)[number];
