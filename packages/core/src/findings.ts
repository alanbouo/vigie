import { z } from "zod";
import { isKnownSignal } from "./signals.js";

/**
 * Schéma de findings unifié (§5 de la spec).
 * Les trois moteurs écrivent dans ce schéma ; le scoring ne lit que lui.
 */

export const PageRefSchema = z.object({
  url: z.string().url(),
  /** Poids SEO de la page : home=10, catégorie=5, produit=3, profonde=1, technique=0.2 */
  poids: z.number().positive().max(10),
});
export type PageRef = z.infer<typeof PageRefSchema>;

export const SeveriteSchema = z.enum(["critique", "important", "info"]);
export const SourceSchema = z.enum(["garde", "diagnostic", "visibilite_ia"]);
export const PilierSchema = z.enum(["seo", "geo", "visibilite"]);
export const StatutSchema = z.enum(["ouvert", "corrige", "acquitte"]);

export const FindingSchema = z.object({
  finding_id: z.string().uuid(),
  site_id: z.string().uuid(),
  source: SourceSchema,
  pilier: PilierSchema,
  signal: z.string().refine(isKnownSignal, {
    message: "signal hors taxonomie contrôlée (annexe A)",
  }),
  severite: SeveriteSchema,
  pages: z.array(PageRefSchema),
  explication: z.string().min(1),
  correctif: z.string().min(1),
  effort: z.number().int().min(1).max(5),
  detecte_le: z.coerce.date(),
  confirme: z.boolean(),
  statut: StatutSchema,
});
export type Finding = z.infer<typeof FindingSchema>;

export function validateFinding(input: unknown): Finding {
  return FindingSchema.parse(input);
}
