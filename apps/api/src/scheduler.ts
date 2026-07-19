import cron from "node-cron";
import { q } from "./db.js";
import { runGarde, envoyerRapportHebdoSite, type SiteRow } from "./gardeService.js";
import { processQueue } from "./diagnosticService.js";

/**
 * Scheduler (§2) : cron hebdo (crawl complet + rapport) + quotidien léger.
 * Les crawls sont séquencés site par site (rate-limit poli, machine solo).
 */

async function sitesActifs(): Promise<SiteRow[]> {
  return q<SiteRow>(`select * from sites where actif order by created_at`);
}

export async function cycleHebdo(): Promise<void> {
  for (const site of await sitesActifs()) {
    try {
      await runGarde(site, "hebdo");
      await envoyerRapportHebdoSite(site);
    } catch (err) {
      console.error(`Crawl hebdo échoué pour ${site.url} :`, err);
    }
  }
}

export async function cycleQuotidien(): Promise<void> {
  for (const site of await sitesActifs()) {
    try {
      await runGarde(site, "quotidien");
    } catch (err) {
      console.error(`Crawl quotidien échoué pour ${site.url} :`, err);
    }
  }
}

export function startScheduler(): void {
  // Crawl hebdo complet + rapport : lundi 05h00.
  cron.schedule("0 5 * * 1", () => {
    void cycleHebdo();
  });
  // Crawl quotidien léger : tous les jours 06h30 (sauf lundi, couvert par l'hebdo).
  cron.schedule("30 6 * * 0,2-6", () => {
    void cycleQuotidien();
  });
  // File des Diagnostics : reprise des jobs en attente (crash-safe).
  cron.schedule("*/10 * * * *", () => {
    void processQueue();
  });
  console.log("Scheduler démarré : hebdo lun. 05h00, quotidien 06h30, file Diagnostic /10min.");
}
