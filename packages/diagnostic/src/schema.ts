import { z } from "zod";
import { isKnownSignal } from "@vigie/core";

/**
 * Sortie structurée du Diagnostic (§4.2, le point critique) :
 * en plus du rapport lisible, le run doit produire un JSON de findings
 * validé par ce schéma. Sans ça : pas de dashboard, pas d'historique
 * comparable, pas de Top 3.
 */

export const DiagnosticFindingSchema = z.object({
  /** Doit appartenir à la taxonomie contrôlée (annexe A). */
  signal: z.string(),
  severite: z.enum(["critique", "important", "info"]),
  pilier: z.enum(["seo", "geo"]).default("seo"),
  urls: z.array(z.string().url()).default([]),
  explication: z.string().min(10),
  correctif: z.string().min(10),
  effort: z.number().int().min(1).max(5).default(2),
});
export type DiagnosticFinding = z.infer<typeof DiagnosticFindingSchema>;

export const DiagnosticOutputSchema = z.object({
  site: z.string().url(),
  profondeur: z.enum(["quick", "full"]),
  resume: z.string().min(20),
  findings: z.array(DiagnosticFindingSchema).max(200),
});
export type DiagnosticOutput = z.infer<typeof DiagnosticOutputSchema>;

/**
 * Sépare les findings dont le signal appartient à la taxonomie (→ base,
 * scoring, Top 3) de ceux hors taxonomie (→ rapport uniquement, avec warning).
 */
export function partitionBySignal(output: DiagnosticOutput): {
  taxonomes: DiagnosticFinding[];
  horsTaxonomie: DiagnosticFinding[];
} {
  const taxonomes: DiagnosticFinding[] = [];
  const horsTaxonomie: DiagnosticFinding[] = [];
  for (const f of output.findings) {
    (isKnownSignal(f.signal) ? taxonomes : horsTaxonomie).push(f);
  }
  return { taxonomes, horsTaxonomie };
}

/** Description compacte du schéma, injectée dans le prompt du run. */
export const OUTPUT_SCHEMA_FOR_PROMPT = `{
  "site": "https://example.com",
  "profondeur": "quick | full",
  "resume": "Synthèse de l'état du site en 3-6 phrases, sans jargon.",
  "findings": [
    {
      "signal": "identifiant de la taxonomie (ex. noindex_added, titles_h1_lost, structured_data_broken, llmstxt_broken, ai_crawler_blocked, meta_description_lost, duplicate_content, internal_links_broken, redirect_chain, content_js_only, cwv_degraded, canonical_external, orphan_pages, page_weight_increase, sitemap_broken)",
      "severite": "critique | important | info",
      "pilier": "seo | geo",
      "urls": ["https://example.com/page"],
      "explication": "Ce qui ne va pas, dit simplement, sans jargon.",
      "correctif": "Action concrète pour corriger.",
      "effort": 1
    }
  ]
}`;
