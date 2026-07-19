import {
  crawlLight,
  crawlSite,
  diffCrawls,
  eventToFinding,
  reconcile,
  type ChangeEvent,
  type CrawlResult,
  type PendingEvent,
} from "@vigie/garde";
import { getSignal, top3, type Finding } from "@vigie/core";
import { one, q } from "./db.js";
import { envoyerAlerte, envoyerRapportHebdo } from "./emails.js";
import { planFor } from "./plans.js";

export interface SiteRow {
  id: string;
  agency_id: string;
  url: string;
  palier: string;
  plafond_pages: number;
  key_pages: string[];
}

/** Cycle complet de la Garde pour un site (§3) : crawl → diff → findings → alertes. */
export async function runGarde(
  site: SiteRow,
  type: "hebdo" | "quotidien"
): Promise<{ crawlId: string; findingsCrees: number; alertesEnvoyees: number }> {
  const crawlRow = await one<{ id: string }>(
    `insert into crawls (site_id, type) values ($1, $2) returning id`,
    [site.id, type]
  );
  const crawlId = crawlRow!.id;

  let result: CrawlResult;
  try {
    const plafond = Math.min(site.plafond_pages, planFor(site.palier).plafondPagesParSite);
    const config = {
      siteUrl: site.url,
      maxPages: plafond,
      keyPages: site.key_pages ?? [],
    };
    result = type === "hebdo" ? await crawlSite(config) : await crawlLight(config);
  } catch (err) {
    await q(`update crawls set statut = 'erreur', finished_at = now(), stats = $2 where id = $1`, [
      crawlId,
      JSON.stringify({ erreur: err instanceof Error ? err.message : String(err) }),
    ]);
    throw err;
  }

  // Stockage des snapshots (§3.2).
  await q(`insert into site_snapshots (crawl_id, data) values ($1, $2)`, [
    crawlId,
    JSON.stringify(result.site),
  ]);
  for (const page of result.pages) {
    await q(
      `insert into page_snapshots (crawl_id, url, content_hash, data) values ($1, $2, $3, $4)`,
      [crawlId, page.url, page.contentHash, JSON.stringify(page)]
    );
  }
  await q(
    `update crawls set statut = 'termine', finished_at = now(), stats = $2 where id = $1`,
    [crawlId, JSON.stringify(result.stats)]
  );

  // Coût par crawl visible dans un log interne (§10, §12).
  await q(
    `insert into cost_log (scope, ref_id, site_id, cout_usd, details) values ('crawl', $1, $2, 0, $3)`,
    [crawlId, site.id, JSON.stringify(result.stats)]
  );

  // Diff contre le crawl précédent (§3.3). Premier crawl = baseline, pas d'alerte.
  const prev = await loadPreviousCrawl(site.id, crawlId, type);
  if (!prev) {
    return { crawlId, findingsCrees: 0, alertesEnvoyees: 0 };
  }

  let events = diffCrawls(prev, result);
  // Le crawl quotidien léger ne voit qu'un fragment du site : seuls les 🔴
  // sont fiables sur ce périmètre (détection immédiate, §3.1).
  if (type === "quotidien") {
    events = events.filter((e) => e.severite === "critique");
  }

  // Confirmation sur 2 crawls (§3.5.2).
  const pendingRows = await q<{ cause_key: string; signal: string; detecte_le: string }>(
    `select cause_key, signal, detecte_le from change_events
     where site_id = $1 and statut = 'en_attente'`,
    [site.id]
  );
  const pending: PendingEvent[] = pendingRows.map((r) => ({
    causeKey: r.cause_key,
    signal: r.signal,
    detecteLe: r.detecte_le,
  }));
  const { confirmes, enAttente, disparus } = reconcile(pending, events);

  for (const e of enAttente) {
    await q(
      `insert into change_events (site_id, crawl_id, signal, cause_key, severite, pages, explication, correctif)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [site.id, crawlId, e.signal, e.causeKey, e.severite, JSON.stringify(e.pages), e.explication, e.correctif]
    );
  }
  if (disparus.length > 0) {
    // Bruit ponctuel non revu : on oublie (§3.5.2).
    await q(
      `update change_events set statut = 'disparu'
       where site_id = $1 and statut = 'en_attente' and cause_key = any($2)`,
      [site.id, disparus]
    );
  }

  let findingsCrees = 0;
  let alertesEnvoyees = 0;
  const agence = await one<{ email: string }>(
    `select email from agencies where id = $1`,
    [site.agency_id]
  );

  for (const e of confirmes) {
    await q(
      `update change_events set statut = 'confirme', confirme = true
       where site_id = $1 and statut = 'en_attente' and cause_key = $2`,
      [site.id, e.causeKey]
    );
    await q(
      `insert into change_events (site_id, crawl_id, signal, cause_key, severite, pages, explication, correctif, confirme, statut)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, 'confirme')`,
      [site.id, crawlId, e.signal, e.causeKey, e.severite, JSON.stringify(e.pages), e.explication, e.correctif]
    );

    // ⚪ Info : dashboard uniquement, jamais d'email, pas de finding (§3.4).
    if (e.severite === "info") continue;

    const finding = await upsertFinding(site.id, e);
    if (finding.created) findingsCrees++;

    // Alerte immédiate hors cycle pour les 🔴 (§3.4), une seule fois par finding.
    const def = getSignal(e.signal);
    if (def.alerteImmediate && finding.alerteAEnvoyer && agence) {
      const ok = await envoyerAlerte(agence.email, finding.finding, site.url);
      if (ok) {
        alertesEnvoyees++;
        await q(
          `update findings set alerte_envoyee_le = now() where finding_id = $1`,
          [finding.finding.finding_id]
        );
      }
    }
  }

  // Log de calibrage : chaque score est journalisé dès J1 (§6.3).
  await logScores(site.id);

  return { crawlId, findingsCrees, alertesEnvoyees };
}

/** Regroupement par cause (§3.5.3) : un finding ouvert par cause, mis à jour au fil des crawls. */
async function upsertFinding(
  siteId: string,
  e: ChangeEvent
): Promise<{ finding: Finding; created: boolean; alerteAEnvoyer: boolean }> {
  const existing = await one<{ finding_id: string; alerte_envoyee_le: string | null }>(
    `select finding_id, alerte_envoyee_le from findings
     where site_id = $1 and cause_key = $2 and statut = 'ouvert'`,
    [siteId, e.causeKey]
  );
  if (existing) {
    await q(
      `update findings set pages = $2, explication = $3, correctif = $4, severite = $5
       where finding_id = $1`,
      [existing.finding_id, JSON.stringify(e.pages), e.explication, e.correctif, e.severite]
    );
    const row = await one<Record<string, unknown>>(
      `select * from findings where finding_id = $1`,
      [existing.finding_id]
    );
    return {
      finding: rowToFinding(row!),
      created: false,
      alerteAEnvoyer: existing.alerte_envoyee_le === null,
    };
  }

  const finding = eventToFinding(e, siteId, { confirme: true });
  await q(
    `insert into findings (finding_id, site_id, source, pilier, signal, severite, pages,
                           explication, correctif, effort, detecte_le, confirme, statut, cause_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      finding.finding_id,
      finding.site_id,
      finding.source,
      finding.pilier,
      finding.signal,
      finding.severite,
      JSON.stringify(finding.pages),
      finding.explication,
      finding.correctif,
      finding.effort,
      finding.detecte_le,
      finding.confirme,
      finding.statut,
      e.causeKey,
    ]
  );
  return { finding, created: true, alerteAEnvoyer: true };
}

export function rowToFinding(row: Record<string, unknown>): Finding {
  return {
    finding_id: row.finding_id as string,
    site_id: row.site_id as string,
    source: row.source as Finding["source"],
    pilier: row.pilier as Finding["pilier"],
    signal: row.signal as string,
    severite: row.severite as Finding["severite"],
    pages: row.pages as Finding["pages"],
    explication: row.explication as string,
    correctif: row.correctif as string,
    effort: row.effort as number,
    detecte_le: new Date(row.detecte_le as string),
    confirme: row.confirme as boolean,
    statut: row.statut as Finding["statut"],
  };
}

async function loadPreviousCrawl(
  siteId: string,
  currentCrawlId: string,
  type: "hebdo" | "quotidien"
): Promise<CrawlResult | null> {
  // Hebdo : comparé au hebdo précédent. Quotidien : comparé au dernier crawl terminé.
  const prevRow = await one<{ id: string; type: "hebdo" | "quotidien"; stats: CrawlResult["stats"] }>(
    `select id, type, stats from crawls
     where site_id = $1 and statut = 'termine' and id <> $2
       and ($3 = 'quotidien' or type = 'hebdo')
     order by started_at desc limit 1`,
    [siteId, currentCrawlId, type]
  );
  if (!prevRow) return null;

  const siteSnap = await one<{ data: CrawlResult["site"] }>(
    `select data from site_snapshots where crawl_id = $1`,
    [prevRow.id]
  );
  if (!siteSnap) return null;
  const pageRows = await q<{ data: CrawlResult["pages"][number] }>(
    `select data from page_snapshots where crawl_id = $1`,
    [prevRow.id]
  );
  return {
    type: prevRow.type,
    site: siteSnap.data,
    pages: pageRows.map((r) => r.data),
    stats: prevRow.stats ?? { pagesCrawled: 0, pagesCapped: false, durationMs: 0, errors: 0 },
  };
}

/** Calcule le Top 3 d'un site sur ses findings ouverts et journalise les scores. */
export async function computeTop3(siteId: string) {
  const rows = await q<Record<string, unknown>>(
    `select * from findings where site_id = $1 and statut = 'ouvert'`,
    [siteId]
  );
  return top3(rows.map(rowToFinding));
}

async function logScores(siteId: string): Promise<void> {
  const { scored } = await computeTop3(siteId);
  for (const s of scored) {
    await q(
      `insert into scores (finding_id, valeur, facteurs) values ($1, $2, $3)`,
      [s.finding.finding_id, s.score, JSON.stringify(s.facteurs)]
    );
  }
}

/** Rapport hebdo (§6.4) : Top 3 ou « ✅ RAS » — jamais de podium artificiel. */
export async function envoyerRapportHebdoSite(site: SiteRow): Promise<void> {
  const { ras, top } = await computeTop3(site.id);
  const semaine = mondayOfWeek(new Date());

  await q(
    `insert into reports (site_id, semaine, ras, top3, envoye_le)
     values ($1, $2, $3, $4, now())
     on conflict (site_id, semaine)
     do update set ras = excluded.ras, top3 = excluded.top3, envoye_le = now()`,
    [
      site.id,
      semaine,
      ras,
      JSON.stringify(
        top.map((s) => ({ finding_id: s.finding.finding_id, score: s.score, signal: s.finding.signal }))
      ),
    ]
  );

  const agence = await one<{ email: string }>(
    `select email from agencies where id = $1`,
    [site.agency_id]
  );
  if (agence) {
    await envoyerRapportHebdo(agence.email, site.url, ras, top);
  }
}

function mondayOfWeek(d: Date): string {
  const date = new Date(d);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}
