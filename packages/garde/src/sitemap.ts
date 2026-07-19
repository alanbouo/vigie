import * as cheerio from "cheerio";
import type { PoliteFetcher } from "./fetcher.js";
import { normalizeUrl } from "./parsePage.js";

export interface SitemapResult {
  url: string | null;
  ok: boolean;
  urlCount: number;
  urls: string[];
}

const MAX_SITEMAP_URLS = 50_000;
const MAX_CHILD_SITEMAPS = 20;

export async function fetchSitemap(
  fetcher: PoliteFetcher,
  siteOrigin: string,
  declaredUrls: string[]
): Promise<SitemapResult> {
  const candidates = declaredUrls.length
    ? declaredUrls
    : [new URL("/sitemap.xml", siteOrigin).toString()];

  for (const candidate of candidates) {
    const res = await fetcher.fetchPage(candidate);
    if (res.error || res.statusCode !== 200 || !res.body.trim()) continue;

    const urls = await parseSitemapBody(fetcher, res.body);
    return {
      url: candidate,
      ok: urls.length > 0,
      urlCount: urls.length,
      urls: urls.slice(0, MAX_SITEMAP_URLS),
    };
  }
  return { url: candidates[0] ?? null, ok: false, urlCount: 0, urls: [] };
}

async function parseSitemapBody(
  fetcher: PoliteFetcher,
  body: string
): Promise<string[]> {
  const $ = cheerio.load(body, { xmlMode: true });

  // Index de sitemaps : un niveau de récursion.
  const children = $("sitemapindex > sitemap > loc")
    .map((_, el) => $(el).text().trim())
    .get()
    .slice(0, MAX_CHILD_SITEMAPS);

  if (children.length > 0) {
    const urls: string[] = [];
    for (const child of children) {
      const res = await fetcher.fetchPage(child);
      if (res.error || res.statusCode !== 200) continue;
      const $$ = cheerio.load(res.body, { xmlMode: true });
      $$("urlset > url > loc").each((_, el) => {
        urls.push(normalizeUrl($$(el).text().trim()));
      });
      if (urls.length >= MAX_SITEMAP_URLS) break;
    }
    return urls;
  }

  return $("urlset > url > loc")
    .map((_, el) => normalizeUrl($(el).text().trim()))
    .get();
}
