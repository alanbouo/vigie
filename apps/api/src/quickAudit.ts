import { crawlLight } from "@vigie/garde";
import { AI_CRAWLERS } from "@vigie/core";

/**
 * Quick audit public (§11 J8) : le lead magnet de la landing.
 * Photo instantanée des fondamentaux (pas de diff — c'est la démo qui donne
 * envie de la Garde, qui elle surveille le changement).
 */

export interface QuickAuditResult {
  url: string;
  constats: {
    niveau: "ok" | "attention" | "critique";
    titre: string;
    detail: string;
  }[];
}

export async function quickAudit(url: string): Promise<QuickAuditResult> {
  const result = await crawlLight({
    siteUrl: url,
    maxPages: 3,
    fetcherOptions: { timeoutMs: 10_000 },
  });

  const constats: QuickAuditResult["constats"] = [];
  const home = result.pages[0];

  if (!home || home.statusCode === 0) {
    constats.push({
      niveau: "critique",
      titre: "Site inaccessible",
      detail: "La page d'accueil n'a pas répondu. Impossible d'aller plus loin.",
    });
    return { url, constats };
  }

  if (home.statusCode >= 500) {
    constats.push({
      niveau: "critique",
      titre: "Erreur serveur",
      detail: `La page d'accueil renvoie une erreur ${home.statusCode}.`,
    });
  } else if (home.statusCode >= 400) {
    constats.push({
      niveau: "critique",
      titre: "Page d'accueil en erreur",
      detail: `La page d'accueil renvoie un code ${home.statusCode}.`,
    });
  }

  if (home.noindex) {
    constats.push({
      niveau: "critique",
      titre: "Page d'accueil non indexable",
      detail:
        "Une balise noindex demande aux moteurs de recherche de ne pas afficher cette page. Si ce n'est pas voulu, c'est la première chose à corriger.",
    });
  }

  if (result.site.robots.blocksSearch) {
    constats.push({
      niveau: "critique",
      titre: "robots.txt bloque les moteurs de recherche",
      detail: "Le fichier robots.txt interdit l'accès du site à Google et Bing.",
    });
  }

  const blocked = AI_CRAWLERS.filter((c) => result.site.robots.aiCrawlersBlocked[c]);
  if (blocked.length > 0) {
    constats.push({
      niveau: "attention",
      titre: "Crawlers IA bloqués",
      detail: `${blocked.join(", ")} ne peuvent pas lire le site : il n'apparaîtra pas dans les réponses de ces IA.`,
    });
  } else {
    constats.push({
      niveau: "ok",
      titre: "Site ouvert aux IA",
      detail: "GPTBot, ClaudeBot, PerplexityBot et Google-Extended peuvent lire le site.",
    });
  }

  if (!result.site.llmsTxt.present) {
    constats.push({
      niveau: "attention",
      titre: "Pas de fichier llms.txt",
      detail:
        "Ce fichier guide les IA vers vos contenus importants. Son absence est une occasion manquée de visibilité IA.",
    });
  }

  if (!result.site.sitemap.ok) {
    constats.push({
      niveau: "attention",
      titre: "Sitemap absent ou vide",
      detail: "Sans sitemap, Google découvre les nouvelles pages beaucoup plus lentement.",
    });
  } else {
    constats.push({
      niveau: "ok",
      titre: "Sitemap présent",
      detail: `${result.site.sitemap.urlCount} URLs déclarées.`,
    });
  }

  if (
    result.site.ssl.daysRemaining !== null &&
    result.site.ssl.daysRemaining <= 14
  ) {
    constats.push({
      niveau: result.site.ssl.daysRemaining <= 7 ? "critique" : "attention",
      titre: "Certificat SSL bientôt expiré",
      detail: `Le certificat expire dans ${result.site.ssl.daysRemaining} jours.`,
    });
  }

  if (!home.title) {
    constats.push({
      niveau: "attention",
      titre: "Pas de balise <title>",
      detail: "La page d'accueil n'a pas de titre : c'est ce que Google affiche dans ses résultats.",
    });
  }
  if (!home.h1) {
    constats.push({
      niveau: "attention",
      titre: "Pas de titre H1",
      detail: "La page d'accueil n'a pas de titre principal H1.",
    });
  }
  if (!home.metaDescription) {
    constats.push({
      niveau: "attention",
      titre: "Pas de meta description",
      detail: "Google improvisera le texte affiché sous votre titre dans les résultats.",
    });
  }
  if (home.structuredData.types.length === 0) {
    constats.push({
      niveau: "attention",
      titre: "Pas de données structurées",
      detail:
        "Aucun balisage schema.org détecté : le site se prive des résultats enrichis et aide moins les IA à le comprendre.",
    });
  } else if (!home.structuredData.valid) {
    constats.push({
      niveau: "attention",
      titre: "Données structurées invalides",
      detail: home.structuredData.errors.join(" ; "),
    });
  } else {
    constats.push({
      niveau: "ok",
      titre: "Données structurées présentes",
      detail: `Types détectés : ${home.structuredData.types.join(", ")}.`,
    });
  }

  return { url, constats };
}
