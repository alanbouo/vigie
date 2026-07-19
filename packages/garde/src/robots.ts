import { AI_CRAWLERS, type AiCrawler } from "@vigie/core";

/**
 * Parseur robots.txt minimal mais correct : groupes par User-agent,
 * règles Allow/Disallow, correspondance par préfixe le plus long.
 */

export interface RobotsGroup {
  userAgents: string[];
  allow: string[];
  disallow: string[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobotsTxt(content: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasUserAgent = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!lastWasUserAgent || !current) {
        current = { userAgents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.userAgents.push(value.toLowerCase());
      lastWasUserAgent = true;
      continue;
    }
    lastWasUserAgent = false;
    if (!current) continue;
    if (field === "disallow") {
      if (value) current.disallow.push(value);
    } else if (field === "allow") {
      if (value) current.allow.push(value);
    }
  }
  return { groups, sitemaps };
}

function groupFor(robots: ParsedRobots, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLen = -1;
  for (const g of robots.groups) {
    for (const gua of g.userAgents) {
      if (gua === "*") {
        if (bestLen < 0) {
          best = g;
          bestLen = 0;
        }
      } else if (ua.includes(gua) && gua.length > bestLen) {
        best = g;
        bestLen = gua.length;
      }
    }
  }
  return best;
}

function matchLength(rule: string, path: string): number {
  // Support minimal des wildcards * et $ (suffisant pour la détection de blocage).
  if (rule.includes("*") || rule.endsWith("$")) {
    const pattern =
      "^" +
      rule
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$");
    try {
      if (new RegExp(pattern).test(path)) return rule.length;
    } catch {
      return -1;
    }
    return -1;
  }
  return path.startsWith(rule) ? rule.length : -1;
}

/** true si `userAgent` est interdit d'accès à `path`. */
export function isDisallowed(
  robots: ParsedRobots,
  userAgent: string,
  path: string
): boolean {
  const group = groupFor(robots, userAgent);
  if (!group) return false;

  let bestAllow = -1;
  let bestDisallow = -1;
  for (const rule of group.allow) {
    bestAllow = Math.max(bestAllow, matchLength(rule, path));
  }
  for (const rule of group.disallow) {
    bestDisallow = Math.max(bestDisallow, matchLength(rule, path));
  }
  if (bestDisallow === -1) return false;
  // La règle la plus longue gagne ; à égalité, Allow gagne (comportement Google).
  return bestDisallow > bestAllow;
}

/** Les bots de recherche « majeurs » pour la détection de blocage SEO. */
const SEARCH_BOTS = ["googlebot", "bingbot"];

export function blocksSearchEngines(robots: ParsedRobots): boolean {
  return SEARCH_BOTS.every((bot) => isDisallowed(robots, bot, "/"));
}

/** État de blocage des crawlers IA surveillés (§3.2). */
export function aiCrawlerBlockState(
  robots: ParsedRobots
): Record<AiCrawler, boolean> {
  const out = {} as Record<AiCrawler, boolean>;
  for (const crawler of AI_CRAWLERS) {
    out[crawler] = isDisallowed(robots, crawler, "/");
  }
  return out;
}
