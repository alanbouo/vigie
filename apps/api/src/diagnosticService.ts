import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  runDiagnostic,
  diagnosticToFindings,
  resolveProvider,
  missingKeyError,
  type ProviderConfig,
} from "@vigie/diagnostic";
import { one, q } from "./db.js";
import { env } from "./env.js";
import { envoyerDiagnosticTermine } from "./emails.js";

/**
 * Orchestration du Diagnostic (§4) : 1 audit = 1 job asynchrone.
 * En production, chaque job tourne dans un conteneur éphémère ; ici le worker
 * consomme la file `diagnostics` (statut en_attente) séquentiellement — le
 * même code se déplace tel quel dans un conteneur/job.
 * Crédits : ne facturer que les jobs aboutis (§4.3).
 */

let workerRunning = false;

/** Résout provider + mode effectifs (défauts serveur, overrides par job). */
export function resolveJobProvider(
  providerOverride?: string | null,
  modeOverride?: string | null
): ProviderConfig {
  return resolveProvider(
    {
      provider: env.llmProvider,
      mode: env.llmMode,
      anthropicApiKey: env.anthropicApiKey,
      xaiApiKey: env.xaiApiKey,
      llmApiKey: env.llmApiKey,
      llmBaseUrl: env.llmBaseUrl,
      llmAgentBaseUrl: env.llmAgentBaseUrl,
      llmModel: env.llmModel,
      llmCostPerMTokInputUsd: env.llmCostPerMTokInputUsd,
      llmCostPerMTokOutputUsd: env.llmCostPerMTokOutputUsd,
    },
    providerOverride ?? undefined,
    modeOverride ?? undefined
  );
}

export async function creerDiagnostic(opts: {
  siteId: string | null;
  agencyId: string;
  url: string;
  profondeur: "quick" | "full";
  offert: boolean;
  provider?: string | null;
  mode?: string | null;
}): Promise<{ id: string }> {
  // Valide provider + mode dès la création (erreur claire avant la mise en file).
  resolveJobProvider(opts.provider, opts.mode);
  const row = await one<{ id: string }>(
    `insert into diagnostics (site_id, agency_id, url, profondeur, offert, provider, mode)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      opts.siteId,
      opts.agencyId,
      opts.url,
      opts.profondeur,
      opts.offert,
      opts.provider ?? null,
      opts.mode ?? null,
    ]
  );
  void processQueue();
  return { id: row!.id };
}

export async function soldeCredits(agencyId: string): Promise<number> {
  const row = await one<{ solde: string }>(
    `select coalesce(sum(delta), 0) as solde from credits where agency_id = $1`,
    [agencyId]
  );
  return Number(row?.solde ?? 0);
}

export async function processQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    for (;;) {
      const job = await one<{
        id: string;
        site_id: string | null;
        agency_id: string;
        url: string;
        profondeur: "quick" | "full";
        offert: boolean;
        provider: string | null;
        mode: string | null;
      }>(
        `update diagnostics set statut = 'en_cours'
         where id = (
           select id from diagnostics where statut = 'en_attente'
           order by created_at limit 1 for update skip locked
         )
         returning id, site_id, agency_id, url, profondeur, offert, provider, mode`
      );
      if (!job) break;
      await executeJob(job);
    }
  } finally {
    workerRunning = false;
  }
}

async function executeJob(job: {
  id: string;
  site_id: string | null;
  agency_id: string;
  url: string;
  profondeur: "quick" | "full";
  offert: boolean;
  provider: string | null;
  mode: string | null;
}): Promise<void> {
  let provider: ProviderConfig;
  try {
    provider = resolveJobProvider(job.provider, job.mode);
  } catch (err) {
    await q(
      `update diagnostics set statut = 'erreur', erreur = $2, finished_at = now() where id = $1`,
      [job.id, err instanceof Error ? err.message : String(err)]
    );
    return;
  }
  const keyError = missingKeyError(provider);
  if (keyError) {
    await q(
      `update diagnostics set statut = 'erreur', erreur = $2, finished_at = now() where id = $1`,
      [job.id, keyError]
    );
    return;
  }

  const outputDir = path.join(env.artifactsDir, job.agency_id, job.id);
  await mkdir(outputDir, { recursive: true });

  const result = await runDiagnostic(
    {
      url: job.url,
      profondeur: job.profondeur,
      workspaceDir: env.diagnosticWorkspace,
      outputDir,
    },
    provider
  );

  // Coût du job instrumenté dès J1 (§4.3).
  await q(
    `insert into cost_log (scope, ref_id, site_id, cout_usd, details)
     values ('diagnostic', $1, $2, $3, $4)`,
    [
      job.id,
      job.site_id,
      result.cout.totalCostUsd,
      JSON.stringify({
        ...result.cout,
        provider: provider.provider,
        mode: provider.mode,
        model: provider.model,
      }),
    ]
  );

  if (!result.ok || !result.output) {
    await q(
      `update diagnostics set statut = 'erreur', erreur = $2, cout = $3, finished_at = now()
       where id = $1`,
      [job.id, result.erreur, JSON.stringify(result.cout)]
    );
    return; // job non abouti → aucun crédit consommé
  }

  // Parsing → findings unifiés (§4.3).
  let findingsCount = 0;
  if (job.site_id) {
    const parsed = diagnosticToFindings(result.output, job.site_id);
    for (const f of parsed.findings) {
      await q(
        `insert into findings (finding_id, site_id, source, pilier, signal, severite, pages,
                               explication, correctif, effort, detecte_le, confirme, statut, cause_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          f.finding_id, f.site_id, f.source, f.pilier, f.signal, f.severite,
          JSON.stringify(f.pages), f.explication, f.correctif, f.effort,
          f.detecte_le, f.confirme, f.statut, `diagnostic:${job.id}:${f.signal}`,
        ]
      );
      findingsCount++;
    }
  }

  const artefacts = {
    rapport_md: path.join(outputDir, "rapport.md"),
    findings_json: path.join(outputDir, "findings.json"),
  };
  await writeFile(
    path.join(outputDir, "resume.json"),
    JSON.stringify({ resume: result.output.resume, findings: findingsCount }, null, 2)
  );

  await q(
    `update diagnostics set statut = 'termine', cout = $2, artefacts = $3, finished_at = now()
     where id = $1`,
    [job.id, JSON.stringify(result.cout), JSON.stringify(artefacts)]
  );

  // Facturation : 1 crédit consommé uniquement si le job a abouti et n'est pas offert.
  if (!job.offert) {
    await q(
      `insert into credits (agency_id, delta, motif) values ($1, -1, $2)`,
      [job.agency_id, `Diagnostic ${job.profondeur} — ${job.url}`]
    );
  }

  const agence = await one<{ email: string }>(
    `select email from agencies where id = $1`,
    [job.agency_id]
  );
  if (agence) {
    await envoyerDiagnosticTermine(agence.email, job.url, job.id);
  }
}
