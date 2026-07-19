/**
 * Paliers (§1.2) — plafonds appliqués dans le code, pas seulement au pricing (§9).
 */
export interface Plan {
  palier: string;
  label: string;
  prixMensuelEur: number;
  maxSites: number;
  plafondPagesParSite: number;
}

export const PLANS: Record<string, Plan> = {
  starter: {
    palier: "starter",
    label: "Starter — 1 site",
    prixMensuelEur: 9,
    maxSites: 1,
    plafondPagesParSite: 500,
  },
  agence10: {
    palier: "agence10",
    label: "Agence — 10 sites",
    prixMensuelEur: 49,
    maxSites: 10,
    plafondPagesParSite: 2000,
  },
  agence25: {
    palier: "agence25",
    label: "Agence — 25 sites",
    prixMensuelEur: 99,
    maxSites: 25,
    plafondPagesParSite: 5000,
  },
};

export const CREDIT_PACKS: Record<
  string,
  { credits: number; prixEur: number; label: string }
> = {
  pack1: { credits: 1, prixEur: 49, label: "1 Diagnostic" },
  pack5: { credits: 5, prixEur: 199, label: "5 Diagnostics" },
  pack10: { credits: 10, prixEur: 349, label: "10 Diagnostics" },
};

export function planFor(palier: string): Plan {
  return PLANS[palier] ?? PLANS.starter;
}
