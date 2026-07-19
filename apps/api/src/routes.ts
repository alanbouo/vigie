import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { one, q } from "./db.js";
import { env } from "./env.js";
import { validateSiteUrl, SsrfError } from "./ssrf.js";
import { planFor, PLANS, CREDIT_PACKS } from "./plans.js";
import { runGarde, computeTop3, rowToFinding, type SiteRow } from "./gardeService.js";
import { creerDiagnostic, soldeCredits } from "./diagnosticService.js";
import { quickAudit } from "./quickAudit.js";
import { SlidingWindowLimiter } from "./rateLimit.js";
import { createCheckoutSession, handleStripeEvent, verifyStripeSignature } from "./stripe.js";

interface AgencyRow {
  id: string;
  name: string;
  email: string;
}

async function authAgency(req: FastifyRequest): Promise<AgencyRow | null> {
  const key = req.headers["x-api-key"];
  if (typeof key !== "string" || !key) return null;
  return one<AgencyRow>(
    `select id, name, email from agencies where api_key = $1`,
    [key]
  );
}

// Anti-abus du lead magnet (§9) : 3 quick audits / IP / jour, 30 / heure global.
const quickAuditPerIp = new SlidingWindowLimiter(3, 24 * 3600 * 1000);
const quickAuditGlobal = new SlidingWindowLimiter(30, 3600 * 1000);

export function registerRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ ok: true }));

  // ── Inscription agence (MVP : sans mot de passe, clé API renvoyée une fois) ──
  app.post("/agencies", async (req, reply) => {
    const body = z
      .object({ name: z.string().min(2), email: z.string().email() })
      .parse(req.body);
    const existing = await one(`select 1 from agencies where email = $1`, [body.email]);
    if (existing) {
      return reply.code(409).send({ erreur: "Un compte existe déjà avec cet email." });
    }
    const row = await one<{ id: string; api_key: string }>(
      `insert into agencies (name, email) values ($1, $2) returning id, api_key`,
      [body.name, body.email]
    );
    return reply.code(201).send({ agency_id: row!.id, api_key: row!.api_key });
  });

  // ── Sites ────────────────────────────────────────────────────
  app.post("/sites", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });

    const body = z
      .object({
        url: z.string(),
        palier: z.string().default("starter"),
        key_pages: z.array(z.string()).default([]),
      })
      .parse(req.body);

    let url: string;
    try {
      url = await validateSiteUrl(body.url);
    } catch (err) {
      if (err instanceof SsrfError) return reply.code(400).send({ erreur: err.message });
      throw err;
    }

    // Plafond de sites du palier, appliqué dans le code (§9).
    const plan = planFor(body.palier);
    const count = await one<{ n: string }>(
      `select count(*) as n from sites where agency_id = $1 and actif`,
      [agency.id]
    );
    if (Number(count?.n ?? 0) >= plan.maxSites) {
      return reply.code(403).send({
        erreur: `Palier ${plan.label} : maximum ${plan.maxSites} sites. Passer au palier supérieur.`,
      });
    }

    const site = await one<{ id: string }>(
      `insert into sites (agency_id, url, palier, plafond_pages, key_pages)
       values ($1, $2, $3, $4, $5)
       on conflict (agency_id, url) do nothing
       returning id`,
      [agency.id, url, plan.palier, plan.plafondPagesParSite, JSON.stringify(body.key_pages)]
    );
    if (!site) return reply.code(409).send({ erreur: "Ce site est déjà surveillé." });

    // Audit d'onboarding offert (§1.2) : un Diagnostic quick gratuit à l'arrivée.
    const diag = await creerDiagnostic({
      siteId: site.id,
      agencyId: agency.id,
      url,
      profondeur: "quick",
      offert: true,
    });

    return reply.code(201).send({ site_id: site.id, diagnostic_offert_id: diag.id });
  });

  app.get("/sites", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const sites = await q(
      `select s.id, s.url, s.palier, s.plafond_pages, s.created_at,
              (select count(*) from findings f
                where f.site_id = s.id and f.statut = 'ouvert' and f.severite = 'critique') as critiques_ouverts,
              (select max(finished_at) from crawls c where c.site_id = s.id and c.statut = 'termine') as dernier_crawl
       from sites s where s.agency_id = $1 and s.actif order by s.created_at`,
      [agency.id]
    );
    return { sites };
  });

  // ── Le Dossier (§1.3) : historique du site ───────────────────
  app.get("/sites/:id/dossier", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const { id } = req.params as { id: string };
    const site = await one<SiteRow & { created_at: string }>(
      `select * from sites where id = $1 and agency_id = $2`,
      [id, agency.id]
    );
    if (!site) return reply.code(404).send({ erreur: "Site introuvable." });

    const [findings, crawls, reports, diagnostics, topResult] = await Promise.all([
      q(
        `select * from findings where site_id = $1 order by
           case severite when 'critique' then 0 when 'important' then 1 else 2 end,
           detecte_le desc limit 100`,
        [id]
      ),
      q(
        `select id, type, statut, stats, started_at, finished_at from crawls
         where site_id = $1 order by started_at desc limit 20`,
        [id]
      ),
      q(`select * from reports where site_id = $1 order by semaine desc limit 12`, [id]),
      q(
        `select id, profondeur, statut, offert, created_at, finished_at from diagnostics
         where site_id = $1 order by created_at desc limit 10`,
        [id]
      ),
      computeTop3(id),
    ]);

    return {
      site: { id: site.id, url: site.url, palier: site.palier, created_at: site.created_at },
      top3: { ras: topResult.ras, top: topResult.top },
      findings,
      crawls,
      reports,
      diagnostics,
    };
  });

  app.get("/sites/:id/top3", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const { id } = req.params as { id: string };
    const site = await one(`select 1 from sites where id = $1 and agency_id = $2`, [id, agency.id]);
    if (!site) return reply.code(404).send({ erreur: "Site introuvable." });
    const { ras, top } = await computeTop3(id);
    return { ras, top };
  });

  // Déclenchement manuel d'un crawl (utile en test / onboarding).
  app.post("/sites/:id/crawl", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const { id } = req.params as { id: string };
    const body = z
      .object({ type: z.enum(["hebdo", "quotidien"]).default("hebdo") })
      .parse(req.body ?? {});
    const site = await one<SiteRow>(
      `select * from sites where id = $1 and agency_id = $2`,
      [id, agency.id]
    );
    if (!site) return reply.code(404).send({ erreur: "Site introuvable." });
    const result = await runGarde(site, body.type);
    return result;
  });

  // ── Findings : acquittement / correction (§3.5.4) ────────────
  app.post("/findings/:id/acquitter", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const { id } = req.params as { id: string };
    const updated = await one(
      `update findings f set statut = 'acquitte'
       from sites s
       where f.finding_id = $1 and f.site_id = s.id and s.agency_id = $2
       returning f.finding_id`,
      [id, agency.id]
    );
    if (!updated) return reply.code(404).send({ erreur: "Finding introuvable." });
    return { ok: true, statut: "acquitte" };
  });

  app.post("/findings/:id/corriger", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const { id } = req.params as { id: string };
    const updated = await one(
      `update findings f set statut = 'corrige'
       from sites s
       where f.finding_id = $1 and f.site_id = s.id and s.agency_id = $2
       returning f.finding_id`,
      [id, agency.id]
    );
    if (!updated) return reply.code(404).send({ erreur: "Finding introuvable." });
    return { ok: true, statut: "corrige" };
  });

  // ── Le Diagnostic (crédits) ──────────────────────────────────
  app.post("/sites/:id/diagnostic", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const { id } = req.params as { id: string };
    const body = z
      .object({ profondeur: z.enum(["quick", "full"]).default("full") })
      .parse(req.body ?? {});
    const site = await one<SiteRow>(
      `select * from sites where id = $1 and agency_id = $2`,
      [id, agency.id]
    );
    if (!site) return reply.code(404).send({ erreur: "Site introuvable." });

    const solde = await soldeCredits(agency.id);
    if (solde < 1) {
      return reply.code(402).send({
        erreur: "Aucun crédit Diagnostic disponible.",
        acheter: Object.entries(CREDIT_PACKS).map(([k, p]) => ({ pack: k, ...p })),
      });
    }
    const diag = await creerDiagnostic({
      siteId: site.id,
      agencyId: agency.id,
      url: site.url,
      profondeur: body.profondeur,
      offert: false,
    });
    return reply.code(202).send({ diagnostic_id: diag.id, statut: "en_attente" });
  });

  app.get("/diagnostics/:id", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const { id } = req.params as { id: string };
    const diag = await one(
      `select id, site_id, url, profondeur, statut, cout, artefacts, offert, erreur, created_at, finished_at
       from diagnostics where id = $1 and agency_id = $2`,
      [id, agency.id]
    );
    if (!diag) return reply.code(404).send({ erreur: "Diagnostic introuvable." });
    return diag;
  });

  app.get("/credits", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    return { solde: await soldeCredits(agency.id) };
  });

  // ── Quick audit public (lead magnet, rate-limité §9) ─────────
  app.post("/public/quick-audit", async (req, reply) => {
    const ip = req.ip;
    if (!quickAuditGlobal.allow("global") || !quickAuditPerIp.allow(ip)) {
      return reply
        .code(429)
        .send({ erreur: "Trop de demandes. Réessayez plus tard." });
    }
    const body = z.object({ url: z.string() }).parse(req.body);
    let url: string;
    try {
      url = await validateSiteUrl(body.url);
    } catch (err) {
      if (err instanceof SsrfError) return reply.code(400).send({ erreur: err.message });
      throw err;
    }
    const result = await quickAudit(url);
    return result;
  });

  // ── Billing ──────────────────────────────────────────────────
  app.get("/billing/plans", async () => ({ plans: PLANS, packs: CREDIT_PACKS }));

  app.post("/billing/checkout", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const body = z
      .object({
        type: z.enum(["abonnement", "credits"]),
        plan_or_pack: z.string(),
      })
      .parse(req.body);
    const session = await createCheckoutSession({
      agencyId: agency.id,
      type: body.type,
      planOrPack: body.plan_or_pack,
    });
    return { checkout_url: session.url };
  });

  app.post(
    "/webhooks/stripe",
    // Corps brut requis pour la vérification de signature.
    { config: { rawBody: true } },
    async (req, reply) => {
      const signature = req.headers["stripe-signature"];
      const payload =
        typeof req.rawBodyString === "string"
          ? req.rawBodyString
          : JSON.stringify(req.body);
      if (
        !env.stripeWebhookSecret ||
        typeof signature !== "string" ||
        !verifyStripeSignature(payload, signature, env.stripeWebhookSecret)
      ) {
        return reply.code(400).send({ erreur: "Signature invalide." });
      }
      await handleStripeEvent(JSON.parse(payload));
      return { received: true };
    }
  );

  // Log de calibrage / unit economics : coûts internes (§10, §12).
  app.get("/internal/costs", async (req, reply) => {
    const agency = await authAgency(req);
    if (!agency) return reply.code(401).send({ erreur: "Clé API invalide." });
    const rows = await q(
      `select scope, count(*) as jobs, coalesce(sum(cout_usd), 0) as total_usd
       from cost_log group by scope`
    );
    return { couts: rows };
  });
}

declare module "fastify" {
  interface FastifyRequest {
    rawBodyString?: string;
  }
}
