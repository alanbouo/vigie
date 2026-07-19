import { describe, expect, it } from "vitest";
import {
  diffCrawls,
  reconcile,
  type ChangeEvent,
  type CrawlResult,
  type PageSnapshot,
  type SiteSnapshot,
} from "@vigie/garde";

function page(url: string, overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url,
    statusCode: 200,
    redirectChain: [],
    finalUrl: url,
    noindex: false,
    canonical: url,
    title: `Titre de ${url}`,
    h1: `H1 de ${url}`,
    metaDescription: "Une description.",
    structuredData: { types: ["WebPage"], valid: true, errors: [] },
    internalLinksOut: [],
    sizeBytes: 60_000,
    textLength: 2_000,
    clickDepth: 1,
    contentHash: `hash-${url}`,
    inSitemap: true,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function site(overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
  return {
    robots: {
      fetched: true,
      statusCode: 200,
      raw: "User-agent: *\nDisallow:",
      blocksSearch: false,
      aiCrawlersBlocked: {
        GPTBot: false,
        ClaudeBot: false,
        PerplexityBot: false,
        "Google-Extended": false,
      },
      sitemapUrls: [],
      ...overrides.robots,
    },
    llmsTxt: { present: true, valid: true, ...overrides.llmsTxt },
    sitemap: { url: "https://ex.com/sitemap.xml", ok: true, urlCount: 10, urls: [], ...overrides.sitemap },
    ssl: { validTo: null, daysRemaining: 90, error: null, ...overrides.ssl },
    cwv: overrides.cwv ?? {},
    fetchedAt: new Date().toISOString(),
  };
}

function crawl(pages: PageSnapshot[], siteSnap: SiteSnapshot = site()): CrawlResult {
  return {
    type: "hebdo",
    site: siteSnap,
    pages,
    stats: { pagesCrawled: pages.length, pagesCapped: false, durationMs: 100, errors: 0 },
  };
}

const HOME = "https://ex.com";

function basePages(n = 20): PageSnapshot[] {
  const pages = [page(HOME, { clickDepth: 0 })];
  for (let i = 1; i < n; i++) {
    pages.push(page(`${HOME}/produits/item-${i}`));
  }
  return pages;
}

function signals(events: ChangeEvent[]): string[] {
  return events.map((e) => e.signal);
}

describe("moteur de diff (§3.3) — seul le changement compte", () => {
  it("aucun événement quand rien ne change", () => {
    const pages = basePages();
    const events = diffCrawls(crawl(pages), crawl(pages));
    expect(events.filter((e) => e.severite !== "info")).toHaveLength(0);
  });

  it("🔴 noindex apparu : regroupé en 1 événement (§3.5.3)", () => {
    const before = basePages();
    const after = before.map((p, i) =>
      i > 0 && i <= 5 ? { ...p, noindex: true } : p
    );
    const events = diffCrawls(crawl(before), crawl(after));
    const noindex = events.filter((e) => e.signal === "noindex_added");
    expect(noindex).toHaveLength(1);
    expect(noindex[0].pages).toHaveLength(5);
    expect(noindex[0].severite).toBe("critique");
  });

  it("🔴 blocage d'un crawler IA apparu", () => {
    const before = crawl(basePages());
    const after = crawl(
      basePages(),
      site({
        robots: {
          fetched: true,
          statusCode: 200,
          raw: "",
          blocksSearch: false,
          aiCrawlersBlocked: {
            GPTBot: true,
            ClaudeBot: true,
            PerplexityBot: false,
            "Google-Extended": false,
          },
          sitemapUrls: [],
        },
      })
    );
    const events = diffCrawls(before, after);
    const blocked = events.find((e) => e.signal === "ai_crawler_blocked");
    expect(blocked).toBeDefined();
    expect(blocked!.explication).toContain("GPTBot");
    expect(blocked!.explication).toContain("ClaudeBot");
  });

  it("🔴 site down quand la home passe en 5xx", () => {
    const before = basePages();
    const after = before.map((p) =>
      p.url === HOME ? { ...p, statusCode: 503 } : p
    );
    const events = diffCrawls(crawl(before), crawl(after));
    expect(signals(events)).toContain("site_down_5xx");
  });

  it("🔴 SSL ≤ 7 jours : émis au franchissement, pas en continu", () => {
    const avant = crawl(basePages(), site({ ssl: { validTo: null, daysRemaining: 30, error: null } }));
    const apres = crawl(basePages(), site({ ssl: { validTo: null, daysRemaining: 5, error: null } }));
    expect(signals(diffCrawls(avant, apres))).toContain("ssl_expiring");
    // Déjà ≤7 la semaine précédente : pas de ré-émission.
    const encore = crawl(basePages(), site({ ssl: { validTo: null, daysRemaining: 4, error: null } }));
    expect(signals(diffCrawls(apres, encore))).not.toContain("ssl_expiring");
  });

  it("pages 4xx : 🟠 sous 10 %, 🔴 au-delà (seuils relatifs §3.5.1)", () => {
    const before = basePages(20);
    const un = before.map((p, i) => (i === 1 ? { ...p, statusCode: 404 } : p));
    const eventsUn = diffCrawls(crawl(before), crawl(un));
    const evtUn = eventsUn.find((e) => e.signal === "pages_4xx");
    expect(evtUn?.severite).toBe("important");

    const cinq = before.map((p, i) => (i >= 1 && i <= 5 ? { ...p, statusCode: 404 } : p));
    const eventsCinq = diffCrawls(crawl(before), crawl(cinq));
    const evtCinq = eventsCinq.find((e) => e.signal === "pages_4xx");
    expect(evtCinq?.severite).toBe("critique");
  });

  it("🔴 sitemap cassé (perte ≥30 % des URLs)", () => {
    const avant = crawl(basePages(), site({ sitemap: { url: "https://ex.com/sitemap.xml", ok: true, urlCount: 100, urls: [] } }));
    const apres = crawl(basePages(), site({ sitemap: { url: "https://ex.com/sitemap.xml", ok: true, urlCount: 50, urls: [] } }));
    expect(signals(diffCrawls(avant, apres))).toContain("sitemap_broken");
  });

  it("🟠 meta descriptions perdues : seuil relatif de 10 %", () => {
    const before = basePages(20);
    // 1 page sur 20 = 5 % : sous le seuil, pas d'événement.
    const sous = before.map((p, i) => (i === 1 ? { ...p, metaDescription: null } : p));
    expect(signals(diffCrawls(crawl(before), crawl(sous)))).not.toContain(
      "meta_description_lost"
    );
    // 3 pages sur 20 = 15 % : événement.
    const dessus = before.map((p, i) =>
      i >= 1 && i <= 3 ? { ...p, metaDescription: null } : p
    );
    expect(signals(diffCrawls(crawl(before), crawl(dessus)))).toContain(
      "meta_description_lost"
    );
  });

  it("🟠 canonical externe", () => {
    const before = basePages(10);
    const after = before.map((p, i) =>
      i === 2 ? { ...p, canonical: "https://autre-domaine.com/page" } : p
    );
    const events = diffCrawls(crawl(before), crawl(after));
    const evt = events.find((e) => e.signal === "canonical_external");
    expect(evt).toBeDefined();
    expect(evt!.severite).toBe("critique"); // 10 % ≥ 5 %
  });

  it("🟠 contenu devenu JS-only sur page clé", () => {
    const before = basePages(10);
    const after = before.map((p, i) =>
      i === 1 ? { ...p, textLength: 50 } : p
    );
    expect(signals(diffCrawls(crawl(before), crawl(after)))).toContain(
      "content_js_only"
    );
  });

  it("⚪ nouvelles pages = info, jamais critique", () => {
    const before = basePages(5);
    const after = [...basePages(5), page(`${HOME}/produits/nouveau`)];
    const events = diffCrawls(crawl(before), crawl(after));
    const evt = events.find((e) => e.signal === "new_pages");
    expect(evt?.severite).toBe("info");
  });
});

describe("confirmation sur 2 crawls (§3.5.2)", () => {
  const evt = (signal: string, causeKey: string, severite: ChangeEvent["severite"] = "important"): ChangeEvent => ({
    signal,
    severite,
    pages: [{ url: `${HOME}/p`, poids: 3 }],
    explication: "…",
    correctif: "…",
    causeKey,
  });

  it("un 🔴 franc (noindex) passe sans attendre", () => {
    const { confirmes, enAttente } = reconcile([], [evt("noindex_added", "noindex_added", "critique")]);
    expect(confirmes).toHaveLength(1);
    expect(enAttente).toHaveLength(0);
  });

  it("un 🟠 vu une fois attend ; revu au crawl suivant, il est confirmé", () => {
    const premier = reconcile([], [evt("orphan_pages", "orphan_pages")]);
    expect(premier.confirmes).toHaveLength(0);
    expect(premier.enAttente).toHaveLength(1);

    const second = reconcile(
      [{ causeKey: "orphan_pages", signal: "orphan_pages", detecteLe: "2026-07-10" }],
      [evt("orphan_pages", "orphan_pages")]
    );
    expect(second.confirmes).toHaveLength(1);
  });

  it("un signal non revu disparaît (bruit ponctuel)", () => {
    const result = reconcile(
      [{ causeKey: "orphan_pages", signal: "orphan_pages", detecteLe: "2026-07-10" }],
      []
    );
    expect(result.disparus).toEqual(["orphan_pages"]);
  });
});
