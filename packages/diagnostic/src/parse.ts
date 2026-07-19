import { randomUUID } from "node:crypto";
import { getSignal, poidsPage, type Finding } from "@vigie/core";
import { partitionBySignal, type DiagnosticOutput, type DiagnosticFinding } from "./schema.js";

/**
 * Post-traitement (§4.3) : parsing de la sortie du Diagnostic vers le schéma
 * de findings unifié (§5). Les findings hors taxonomie restent dans le rapport
 * mais n'entrent pas dans le scoring.
 */

export interface ParsedDiagnostic {
  findings: Finding[];
  horsTaxonomie: DiagnosticFinding[];
}

export function diagnosticToFindings(
  output: DiagnosticOutput,
  siteId: string
): ParsedDiagnostic {
  const { taxonomes, horsTaxonomie } = partitionBySignal(output);

  const findings: Finding[] = taxonomes.map((f) => {
    const def = getSignal(f.signal);
    return {
      finding_id: randomUUID(),
      site_id: siteId,
      source: "diagnostic" as const,
      pilier: f.pilier,
      signal: f.signal,
      severite: f.severite,
      pages: f.urls.map((url) => ({ url, poids: poidsPage(url) })),
      explication: f.explication,
      correctif: f.correctif,
      effort: f.effort ?? def.effortDefaut,
      detecte_le: new Date(),
      // Un constat du Diagnostic est vérifié par l'audit lui-même.
      confirme: true,
      statut: "ouvert" as const,
    };
  });

  return { findings, horsTaxonomie };
}
