import { PoliteFetcher, type FetcherOptions } from "./fetcher.js";
import {
  parseRobotsTxt,
  isDisallowed,
  blocksSearchEngines,
  aiCrawlerBlockState,
  type ParsedRobots,
} from "./robots.js";
import { fetchSitemap } from "./sitemap.js";
import { checkSsl } from "./ssl.js";
import { normalizeUrl, parsePage, sameSite } from "./parsePage.js";
import type { CrawlResult, PageSnapshot, SiteSnapshot } from "./types.js";
import { AI_CRAWLERS, type AiCrawler } from "@vigie/core";

export interface CrawlConfig {
  siteUrl: string;
  /** Plafond de pages par palier (appliqué dans le code, §9). */
  maxPages: number;
  /** Pages clés pour le crawl quotidien léger et les CWV. */
  keyPages?: string[];
  fetcherOptions?: FetcherOptions;
  /** Vérifie le SSL (désactivable pour les tests hors réseau). */
  checkSslEnabled?: boolean;
}

async function fetchSiteSnapshot(
  fetcher: PoliteFetcher,
  siteUrl: string,
  checkSslEnabled: boolean
): Promise<{ site: SiteSnapshot; robots: ParsedRobots | null }> {
  const origin = new URL(siteUrl).origin;

  const robotsRes = await fetcher.fetchPage(new URL("/robots.txt", origin).toString());
  const robotsOk = !robotsRes.error && robotsRes.statusCode === 200;
  const robots = robotsOk ? parseRobotsTxt(robotsRes.body) : null;

  const llmsRes = await fetcher.fetchPage(new URL("/llms.txt", origin).toString());
  const llmsPresent = !llmsRes.error && llmsRes.statusCode === 200;
  // Validité minimale : non vide et contient au moins un titre ou un lien markdown.
  const llmsValid =
    llmsPresent &&
    llmsRes.body.trim().length > 0 &&
    (/^#\s+/m.test(llmsRes.body) || /\[.+\]\(.+\)/.test(llmsRes.body));

  const sitemap = await fetchSitemap(fetcher, origin, robots?.sitemaps ?? []);

  const ssl = checkSslEnabled
    ? await checkSsl(new URL(origin).hostname)
    : { validTo: null, daysRemaining: null, error: "désactivé" };

  const site: SiteSnapshot = {
    robots: {
      fetched: robotsOk,
      statusCode: robotsRes.error ? null : robotsRes.statusCode,
      raw: robotsOk ? robotsRes.body : null,
      blocksSearch: robots ? blocksSearchEngines(robots) : false,
      aiCrawlersBlocked: robots
        ? aiCrawlerBlockState(robots)
        : (Object.fromEntries(AI_CRAWLERS.map((c) => [c, false])) as Record<
            AiCrawler,
            boolean
          >),
      sitemapUrls: robots?.sitemaps ?? [],
    },
    llmsTxt: { present: llmsPresent, valid: llmsValid },
    sitemap: {
      url: sitemap.url,
      ok: sitemap.ok,
      urlCount: sitemap.urlCount,
      urls: sitemap.urls,
    },
    ssl,
    cwv: {},
    fetchedAt: new Date().toISOString(),
  };
  return { site, robots };
}

/**
 * Crawl hebdo complet (§3.1) : BFS depuis la home + URLs du sitemap,
 * plafond de pages, profondeur de clic, respect de robots.txt pour VigieBot.
 */
export async function crawlSite(config: CrawlConfig): Promise<CrawlResult> {
  const started = Date.now();
  const fetcher = new PoliteFetcher(config.fetcherOptions);
  const origin = new URL(config.siteUrl).origin;

  const { site, robots } = await fetchSiteSnapshot(
    fetcher,
    config.siteUrl,
    config.checkSslEnabled ?? true
  );

  const inSitemap = new Set(site.sitemap.urls);
  const queue: { url: string; depth: number }[] = [
    { url: normalizeUrl(config.siteUrl), depth: 0 },
  ];
  for (const url of site.sitemap.urls) {
    queue.push({ url, depth: 1 });
  }

  const seen = new Set<string>();
  const pages: PageSnapshot[] = [];
  let errors = 0;
  let capped = false;

  while (queue.length > 0) {
    if (pages.length >= config.maxPages) {
      capped = true;
      break;
    }
    const { url, depth } = queue.shift()!;
    const normalized = normalizeUrl(url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (!sameSite(normalized, origin)) continue;

    // Respect de robots.txt pour notre propre crawler (§3.1).
    if (robots && isDisallowed(robots, "VigieBot", new URL(normalized).pathname)) {
      continue;
    }

    const fetched = await fetcher.fetchPage(normalized);
    if (fetched.error) {
      errors++;
      pages.push(
        parsePage(fetched, {
          siteOrigin: origin,
          clickDepth: depth,
          inSitemap: inSitemap.has(normalized),
        })
      );
      continue;
    }

    const snapshot = parsePage(fetched, {
      siteOrigin: origin,
      clickDepth: depth,
      inSitemap: inSitemap.has(normalized),
    });
    pages.push(snapshot);

    if (snapshot.statusCode === 200) {
      for (const link of snapshot.internalLinksOut) {
        if (!seen.has(link)) queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  return {
    type: "hebdo",
    site,
    pages,
    stats: {
      pagesCrawled: pages.length,
      pagesCapped: capped,
      durationMs: Date.now() - started,
      errors,
    },
  };
}

/**
 * Crawl quotidien léger (§3.1) : home + robots.txt + sitemap + statuts des
 * pages clés — pour détecter les 🔴 sans attendre le cycle hebdo.
 */
export async function crawlLight(config: CrawlConfig): Promise<CrawlResult> {
  const started = Date.now();
  const fetcher = new PoliteFetcher(config.fetcherOptions);
  const origin = new URL(config.siteUrl).origin;

  const { site } = await fetchSiteSnapshot(
    fetcher,
    config.siteUrl,
    config.checkSslEnabled ?? true
  );

  const targets = [
    normalizeUrl(config.siteUrl),
    ...(config.keyPages ?? []).map(normalizeUrl),
  ];
  const seen = new Set<string>();
  const pages: PageSnapshot[] = [];
  let errors = 0;

  for (const url of targets) {
    if (seen.has(url)) continue;
    seen.add(url);
    const fetched = await fetcher.fetchPage(url);
    if (fetched.error) errors++;
    pages.push(
      parsePage(fetched, {
        siteOrigin: origin,
        clickDepth: 0,
        inSitemap: site.sitemap.urls.includes(url),
      })
    );
  }

  return {
    type: "quotidien",
    site,
    pages,
    stats: {
      pagesCrawled: pages.length,
      pagesCapped: false,
      durationMs: Date.now() - started,
      errors,
    },
  };
}
