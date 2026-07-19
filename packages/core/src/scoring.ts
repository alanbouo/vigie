import type { Finding } from "./findings.js";
import { getSignal, type Famille } from "./signals.js";

/**
 * Le cerveau (§6) : score = (impact_base × ampleur × fraîcheur × confiance) / effort
 * Un seul algorithme de priorisation pour les trois moteurs.
 */

export interface ScoreFacteurs {
  impactBase: number;
  ampleur: number;
  fraicheur: number;
  confiance: number;
  effort: number;
}

export interface ScoredFinding {
  finding: Finding;
  score: number;
  facteurs: ScoreFacteurs;
}

export interface Top3Result {
  /** true = « ✅ RAS », aucun podium (plancher §6.2.3). */
  ras: boolean;
  top: ScoredFinding[];
  /** Tous les findings scorés (pour le log de calibrage §6.3). */
  scored: ScoredFinding[];
}

/** Plancher : aucun score > 2.0 → « ✅ RAS », jamais de podium artificiel. */
export const SCORE_PLANCHER = 2.0;
/** Diversité : max 2 signaux d'une même famille au podium. */
export const MAX_PAR_FAMILLE = 2;

const SEMAINE_MS = 7 * 24 * 3600 * 1000;

export function fraicheur(detecteLe: Date, maintenant: Date = new Date()): number {
  const ageSemaines = (maintenant.getTime() - detecteLe.getTime()) / SEMAINE_MS;
  if (ageSemaines <= 1) return 1.5; // cette semaine — le Top 3 doit vivre
  if (ageSemaines <= 4) return 1.0; // 2-4 semaines
  return 0.6; // > 1 mois
}

export function ampleur(finding: Finding): number {
  const sommePoids = finding.pages.reduce((acc, p) => acc + p.poids, 0);
  // Le log empêche le massif-mineur d'écraser le fatal-ponctuel.
  return Math.log10(1 + sommePoids);
}

export function confiance(finding: Finding): number {
  return finding.confirme ? 1.0 : 0.5;
}

export function scoreFinding(
  finding: Finding,
  maintenant: Date = new Date()
): ScoredFinding {
  const def = getSignal(finding.signal);
  const facteurs: ScoreFacteurs = {
    impactBase: def.impactBase,
    ampleur: ampleur(finding),
    fraicheur: fraicheur(finding.detecte_le, maintenant),
    confiance: confiance(finding),
    effort: finding.effort,
  };
  const score =
    (facteurs.impactBase *
      facteurs.ampleur *
      facteurs.fraicheur *
      facteurs.confiance) /
    facteurs.effort;
  return { finding, score: Math.round(score * 100) / 100, facteurs };
}

function estCritiqueConfirme(f: Finding): boolean {
  return f.severite === "critique" && f.confirme;
}

/**
 * Top 3 avec garde-fous (§6.2) :
 * 1. Override critique : un 🔴 confirmé entre d'office au podium.
 * 2. Diversité : max 2 signaux d'une même famille.
 * 3. Plancher : aucun score > 2.0 → RAS.
 * 4. Acquitté / corrigé = exclu du calcul.
 */
export function top3(
  findings: Finding[],
  maintenant: Date = new Date()
): Top3Result {
  const actifs = findings.filter(
    (f) => f.statut === "ouvert" && f.severite !== "info"
  );
  const scored = actifs
    .map((f) => scoreFinding(f, maintenant))
    .sort((a, b) => b.score - a.score);

  // Plancher : semaine calme = RAS (sauf critique confirmé, qui override).
  const critiques = scored.filter((s) => estCritiqueConfirme(s.finding));
  const auDessusDuPlancher = scored.some((s) => s.score > SCORE_PLANCHER);
  if (!auDessusDuPlancher && critiques.length === 0) {
    return { ras: true, top: [], scored };
  }

  const top: ScoredFinding[] = [];
  const parFamille = new Map<Famille, number>();

  const ajouter = (s: ScoredFinding): boolean => {
    if (top.length >= 3) return false;
    if (top.some((t) => t.finding.finding_id === s.finding.finding_id)) {
      return false;
    }
    const famille = getSignal(s.finding.signal).famille;
    const n = parFamille.get(famille) ?? 0;
    if (n >= MAX_PAR_FAMILLE) return false;
    parFamille.set(famille, n + 1);
    top.push(s);
    return true;
  };

  // 1. Les critiques confirmés d'abord (override), par score décroissant.
  for (const s of critiques) ajouter(s);
  // 2. Puis le reste, au-dessus du plancher uniquement.
  for (const s of scored) {
    if (s.score > SCORE_PLANCHER) ajouter(s);
  }

  return { ras: top.length === 0, top, scored };
}
