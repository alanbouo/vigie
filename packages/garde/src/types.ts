import type { AiCrawler } from "@vigie/core";

/** Snapshot d'une page (§3.2) — l'état stocké à chaque crawl. */
export interface PageSnapshot {
  url: string;
  statusCode: number;
  /** Chaîne de redirections traversées pour atteindre l'URL finale. */
  redirectChain: string[];
  finalUrl: string;
  /** meta robots ou X-Robots-Tag contenant noindex. */
  noindex: boolean;
  canonical: string | null;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  structuredData: {
    types: string[];
    valid: boolean;
    errors: string[];
  };
  /** Liens internes sortants (URLs normalisées). */
  internalLinksOut: string[];
  sizeBytes: number;
  /** Longueur du texte visible dans le HTML brut (détection JS-only). */
  textLength: number;
  clickDepth: number;
  contentHash: string;
  inSitemap: boolean;
  fetchedAt: string;
}

/** Snapshot au niveau site (§3.2). */
export interface SiteSnapshot {
  robots: {
    fetched: boolean;
    statusCode: number | null;
    raw: string | null;
    /** true si '*' ou les bots de recherche majeurs sont bloqués sur '/'. */
    blocksSearch: boolean;
    /** Par crawler IA : true = bloqué. */
    aiCrawlersBlocked: Record<AiCrawler, boolean>;
    sitemapUrls: string[];
  };
  llmsTxt: {
    present: boolean;
    valid: boolean;
  };
  sitemap: {
    url: string | null;
    ok: boolean;
    urlCount: number;
    urls: string[];
  };
  ssl: {
    validTo: string | null;
    daysRemaining: number | null;
    error: string | null;
  };
  /** Core Web Vitals des pages clés (lab léger ou API PageSpeed). */
  cwv: Record<string, { lcpMs: number | null; cls: number | null }>;
  fetchedAt: string;
}

export interface CrawlResult {
  type: "hebdo" | "quotidien";
  site: SiteSnapshot;
  pages: PageSnapshot[];
  stats: {
    pagesCrawled: number;
    pagesCapped: boolean;
    durationMs: number;
    errors: number;
  };
}

/** Événement de changement normalisé émis par le moteur de diff (§3.3). */
export interface ChangeEvent {
  signal: string;
  severite: "critique" | "important" | "info";
  pages: { url: string; poids: number }[];
  explication: string;
  correctif: string;
  /** Clé de regroupement par cause : 1 cause = 1 événement (§3.5.3). */
  causeKey: string;
}
