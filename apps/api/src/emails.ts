import {
  alerteEnTexte,
  construireAlerte,
  type Finding,
  type ScoredFinding,
} from "@vigie/core";
import { env } from "./env.js";

/**
 * Alertes et rapports par email (Resend, §2).
 * Format d'alerte invariant (§6.4) : quoi → pourquoi → comment → acquitter.
 * Jamais de score exposé, jamais de liste de 200 items.
 */

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!env.resendApiKey) {
    console.log(`[email désactivé — RESEND_API_KEY absent] À: ${to} | ${subject}\n${text}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text }),
  });
  if (!res.ok) {
    console.error(`Envoi email échoué (${res.status}) : ${await res.text()}`);
    return false;
  }
  return true;
}

/** Alerte immédiate (🔴) — propose le Diagnostic en un clic (§1.2). */
export async function envoyerAlerte(
  to: string,
  finding: Finding,
  siteUrl: string
): Promise<boolean> {
  const alerte = construireAlerte(finding, {
    appBaseUrl: env.appBaseUrl,
    siteUrl,
    proposerDiagnostic: true,
  });
  return sendEmail(to, alerte.sujet, alerteEnTexte(alerte));
}

/** Rapport hebdo : Top 3 ou « ✅ RAS » — jamais de podium artificiel (§3.5). */
export async function envoyerRapportHebdo(
  to: string,
  siteUrl: string,
  ras: boolean,
  top: ScoredFinding[]
): Promise<boolean> {
  if (ras) {
    return sendEmail(
      to,
      `✅ RAS cette semaine — ${siteUrl}`,
      `La Garde a surveillé ${siteUrl} cette semaine.\n\nRien à signaler : aucune régression détectée.\n\nLe Dossier complet : ${env.appBaseUrl}/sites`
    );
  }

  const blocs = top.map((s, i) => {
    const alerte = construireAlerte(s.finding, {
      appBaseUrl: env.appBaseUrl,
      siteUrl,
      proposerDiagnostic: s.finding.severite === "critique",
    });
    return [
      `── Priorité n°${i + 1} ─────────────────────────`,
      alerteEnTexte(alerte),
    ].join("\n");
  });

  return sendEmail(
    to,
    `Votre Top 3 de la semaine — ${siteUrl}`,
    [
      `La Garde a surveillé ${siteUrl} cette semaine.`,
      `Voici les ${top.length > 1 ? `${top.length} priorités` : "priorité"} à traiter, dans l'ordre :`,
      ``,
      ...blocs,
      ``,
      `Le Dossier complet : ${env.appBaseUrl}/sites`,
    ].join("\n")
  );
}

export async function envoyerDiagnosticTermine(
  to: string,
  siteUrl: string,
  diagnosticId: string
): Promise<boolean> {
  return sendEmail(
    to,
    `Votre Diagnostic est prêt — ${siteUrl}`,
    `Le Diagnostic complet de ${siteUrl} est terminé.\n\nRapport et plan d'action : ${env.appBaseUrl}/diagnostics/${diagnosticId}\n\nLes constats sont intégrés au Dossier du site et au Top 3.`
  );
}
