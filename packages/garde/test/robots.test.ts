import { describe, expect, it } from "vitest";
import {
  aiCrawlerBlockState,
  blocksSearchEngines,
  isDisallowed,
  parseRobotsTxt,
} from "@vigie/garde";

describe("parseRobotsTxt", () => {
  it("parse les groupes, règles et sitemaps", () => {
    const robots = parseRobotsTxt(`
# commentaire
User-agent: *
Disallow: /admin
Allow: /admin/public

Sitemap: https://ex.com/sitemap.xml
`);
    expect(robots.sitemaps).toEqual(["https://ex.com/sitemap.xml"]);
    expect(isDisallowed(robots, "Googlebot", "/admin/secret")).toBe(true);
    expect(isDisallowed(robots, "Googlebot", "/admin/public/x")).toBe(false);
    expect(isDisallowed(robots, "Googlebot", "/blog")).toBe(false);
  });

  it("le groupe le plus spécifique gagne sur *", () => {
    const robots = parseRobotsTxt(`
User-agent: *
Disallow: /

User-agent: Googlebot
Disallow:
`);
    expect(isDisallowed(robots, "Googlebot", "/")).toBe(false);
    expect(isDisallowed(robots, "Bingbot", "/")).toBe(true);
  });

  it("détecte le blocage complet des moteurs de recherche", () => {
    const bloquant = parseRobotsTxt(`User-agent: *\nDisallow: /`);
    const ouvert = parseRobotsTxt(`User-agent: *\nDisallow: /admin`);
    expect(blocksSearchEngines(bloquant)).toBe(true);
    expect(blocksSearchEngines(ouvert)).toBe(false);
  });

  it("détecte le blocage des crawlers IA (§3.2)", () => {
    const robots = parseRobotsTxt(`
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: *
Disallow: /admin
`);
    const state = aiCrawlerBlockState(robots);
    expect(state.GPTBot).toBe(true);
    expect(state.ClaudeBot).toBe(true);
    expect(state.PerplexityBot).toBe(false);
    expect(state["Google-Extended"]).toBe(false);
  });

  it("gère les wildcards", () => {
    const robots = parseRobotsTxt(`User-agent: *\nDisallow: /*.pdf$`);
    expect(isDisallowed(robots, "Googlebot", "/doc.pdf")).toBe(true);
    expect(isDisallowed(robots, "Googlebot", "/doc.html")).toBe(false);
  });

  it("groupes multi user-agent consécutifs", () => {
    const robots = parseRobotsTxt(`
User-agent: GPTBot
User-agent: PerplexityBot
Disallow: /
`);
    const state = aiCrawlerBlockState(robots);
    expect(state.GPTBot).toBe(true);
    expect(state.PerplexityBot).toBe(true);
    expect(state.ClaudeBot).toBe(false);
  });
});
