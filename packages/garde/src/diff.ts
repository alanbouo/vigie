import { poidsPage, AI_CRAWLERS } from "@vigie/core";
import type { ChangeEvent, CrawlResult, PageSnapshot } from "./types.js";

/**
 * Le moteur de diff (§3.3) : compare le snapshot N au snapshot N-1 et émet des
 * événements de changement normalisés. Aucun état absolu ne déclenche d'alerte :
 * seul le changement compte.
 *
 * Règles anti-bruit appliquées ici (§3.5) :
 * - seuils relatifs (% du site), pas absolus ;
 * - regroupement par cause : 40 pages sans H1 = 1 événement, pas 40.
 * (La confirmation sur 2 crawls est gérée par confirm.ts.)
 */

function ref(p: PageSnapshot) {
  return { url: p.url, poids: poidsPage(p.url, p.clickDepth) };
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : (n / total) * 100;
}

function byUrl(pages: PageSnapshot[]): Map<string, PageSnapshot> {
  return new Map(pages.map((p) => [p.url, p]));
}

const CORRECTIFS: Record<string, string> = {
  noindex_added:
    "Retirer la balise <meta name=\"robots\" content=\"noindex\"> (ou l'en-tête X-Robots-Tag) des pages concernées. Souvent causé par une case « Demander aux moteurs de ne pas indexer » cochée dans le CMS, ou un déploiement d'environnement de préproduction.",
  robots_blocking_added:
    "Retirer la directive « Disallow: / » (ou les règles bloquantes) du fichier robots.txt pour les moteurs de recherche. Vérifier qu'un robots.txt de préproduction n'a pas été déployé en production.",
  ai_crawler_blocked:
    "Retirer les règles Disallow visant ces crawlers IA dans robots.txt (ou vérifier le pare-feu/CDN qui les bloque). Si le blocage est un choix délibéré, acquitter l'alerte.",
  site_down_5xx:
    "Vérifier l'état du serveur ou de l'hébergeur (logs d'erreur, déploiement récent, base de données). Si l'erreur persiste plus de quelques heures, contacter l'hébergeur.",
  ssl_expiring:
    "Renouveler le certificat SSL (souvent : relancer le renouvellement automatique Let's Encrypt, ou renouveler auprès de l'hébergeur/registrar).",
  canonical_external:
    "Corriger la balise <link rel=\"canonical\"> pour qu'elle pointe vers l'URL de la page elle-même (ou la bonne version interne). Souvent causé par un copier-coller de thème ou une mauvaise configuration de plugin SEO.",
  pages_4xx:
    "Restaurer les pages supprimées par erreur, ou mettre en place des redirections 301 vers les pages de remplacement.",
  sitemap_broken:
    "Régénérer le sitemap (plugin SEO ou générateur du CMS) et vérifier qu'il est accessible à l'URL déclarée dans robots.txt.",
  cwv_degraded:
    "Identifier ce qui a été ajouté récemment (script, images lourdes, widget tiers) et l'optimiser ou le retirer. Compresser les images, différer les scripts non critiques.",
  redirect_chain:
    "Faire pointer chaque redirection directement vers l'URL finale (une seule 301, pas de chaîne). Corriger les boucles en vérifiant les règles de redirection contradictoires.",
  titles_h1_lost:
    "Restaurer les balises <title> et <h1> manquantes ou les rendre uniques. Vérifier le template ou le plugin SEO qui les générait.",
  content_js_only:
    "Réactiver le rendu serveur (SSR) ou le pré-rendu de ces pages : le contenu doit être présent dans le HTML initial, pas seulement après exécution du JavaScript.",
  structured_data_broken:
    "Corriger le JSON-LD invalide (souvent une virgule ou un guillemet cassé après une mise à jour de plugin). Tester avec l'outil de résultats enrichis de Google.",
  internal_links_broken:
    "Corriger ou retirer les liens internes pointant vers des pages en erreur, ou restaurer les pages cibles.",
  llmstxt_broken:
    "Restaurer le fichier llms.txt à la racine du site avec la liste des contenus importants au format Markdown.",
  duplicate_content:
    "Choisir une version canonique pour chaque groupe de pages identiques et rediriger (ou canoniser) les autres vers elle.",
  page_weight_increase:
    "Compresser les images récemment ajoutées (WebP, dimensions adaptées) et vérifier les scripts ou polices ajoutés.",
  meta_description_lost:
    "Restaurer les meta descriptions manquantes (vérifier le plugin SEO ou le template qui les générait).",
  orphan_pages:
    "Rétablir au moins un lien interne vers ces pages depuis les menus, catégories ou contenus liés.",
};

export function diffCrawls(prev: CrawlResult, next: CrawlResult): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const prevPages = byUrl(prev.pages);
  const nextPages = byUrl(next.pages);
  // Pages présentes dans les deux crawls : base des seuils relatifs.
  const common = [...nextPages.values()].filter((p) => prevPages.has(p.url));
  const total = common.length;

  const push = (e: ChangeEvent) => {
    events.push(e);
  };

  // ── 🔴 noindex apparu ─────────────────────────────────────────
  const noindexed = common.filter(
    (p) => p.statusCode === 200 && p.noindex && !prevPages.get(p.url)!.noindex
  );
  if (noindexed.length > 0) {
    push({
      signal: "noindex_added",
      severite: "critique",
      pages: noindexed.map(ref),
      explication: `Une balise noindex est apparue sur ${noindexed.length} page${noindexed.length > 1 ? "s" : ""} qui étai${noindexed.length > 1 ? "ent" : "t"} indexable${noindexed.length > 1 ? "s" : ""} la semaine dernière.`,
      correctif: CORRECTIFS.noindex_added,
      causeKey: "noindex_added",
    });
  }

  // ── 🔴 robots.txt bloquant apparu (moteurs de recherche) ──────
  if (!prev.site.robots.blocksSearch && next.site.robots.blocksSearch) {
    push({
      signal: "robots_blocking_added",
      severite: "critique",
      pages: [{ url: new URL("/robots.txt", homeUrl(next)).toString(), poids: 10 }],
      explication:
        "Le fichier robots.txt bloque désormais l'accès des moteurs de recherche (Googlebot, Bingbot) à l'ensemble du site. Ce blocage n'existait pas au crawl précédent.",
      correctif: CORRECTIFS.robots_blocking_added,
      causeKey: "robots_blocking_added",
    });
  }

  // ── 🔴 Blocage d'un crawler IA apparu ─────────────────────────
  const newlyBlocked = AI_CRAWLERS.filter(
    (c) => !prev.site.robots.aiCrawlersBlocked[c] && next.site.robots.aiCrawlersBlocked[c]
  );
  if (newlyBlocked.length > 0) {
    push({
      signal: "ai_crawler_blocked",
      severite: "critique",
      pages: [{ url: new URL("/robots.txt", homeUrl(next)).toString(), poids: 10 }],
      explication: `Le robots.txt bloque désormais ${newlyBlocked.length > 1 ? "les crawlers IA" : "le crawler IA"} ${newlyBlocked.join(", ")}, qui ${newlyBlocked.length > 1 ? "étaient autorisés" : "était autorisé"} au crawl précédent.`,
      correctif: CORRECTIFS.ai_crawler_blocked,
      causeKey: `ai_crawler_blocked:${[...newlyBlocked].sort().join("+")}`,
    });
  }

  // ── 🔴 Site down / 5xx ────────────────────────────────────────
  const now5xx = [...nextPages.values()].filter(
    (p) => p.statusCode >= 500 || p.statusCode === 0
  );
  const home = [...nextPages.values()].find((p) => poidsPage(p.url) === 10);
  const homeDown = home !== undefined && (home.statusCode >= 500 || home.statusCode === 0);
  if (homeDown || now5xx.length >= 3) {
    const was5xx = (p: PageSnapshot) => {
      const before = prevPages.get(p.url);
      return before !== undefined && (before.statusCode >= 500 || before.statusCode === 0);
    };
    const newDown = now5xx.filter((p) => !was5xx(p));
    if (newDown.length > 0 || (homeDown && home && !was5xx(home))) {
      push({
        signal: "site_down_5xx",
        severite: "critique",
        pages: (newDown.length > 0 ? newDown : [home!]).map(ref),
        explication: homeDown
          ? "La page d'accueil renvoie une erreur serveur : le site est probablement down."
          : `${newDown.length} pages renvoient désormais une erreur serveur (5xx).`,
        correctif: CORRECTIFS.site_down_5xx,
        causeKey: "site_down_5xx",
      });
    }
  }

  // ── 🔴 SSL expiré / ≤7 jours ──────────────────────────────────
  const prevDays = prev.site.ssl.daysRemaining;
  const nextDays = next.site.ssl.daysRemaining;
  if (nextDays !== null && nextDays <= 7 && (prevDays === null || prevDays > 7)) {
    push({
      signal: "ssl_expiring",
      severite: "critique",
      pages: [{ url: homeUrl(next), poids: 10 }],
      explication:
        nextDays < 0
          ? "Le certificat SSL du site est expiré."
          : `Le certificat SSL du site expire dans ${nextDays} jour${nextDays > 1 ? "s" : ""}.`,
      correctif: CORRECTIFS.ssl_expiring,
      causeKey: "ssl_expiring",
    });
  }

  // ── 🔴 Canonical vers l'extérieur ─────────────────────────────
  const externalCanonical = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return (
      p.statusCode === 200 &&
      isExternalCanonical(p) &&
      !isExternalCanonical(before)
    );
  });
  if (externalCanonical.length > 0) {
    const share = pct(externalCanonical.length, total);
    const touchesHome = externalCanonical.some((p) => poidsPage(p.url) === 10);
    push({
      signal: "canonical_external",
      severite: share >= 5 || touchesHome ? "critique" : "important",
      pages: externalCanonical.map(ref),
      explication: `${externalCanonical.length} page${externalCanonical.length > 1 ? "s" : ""} déclare${externalCanonical.length > 1 ? "nt" : ""} désormais une URL canonique pointant vers un autre domaine (${share.toFixed(0)} % des pages suivies).`,
      correctif: CORRECTIFS.canonical_external,
      causeKey: "canonical_external",
    });
  }

  // ── 🔴/🟠 Pages passées en 4xx ────────────────────────────────
  const now4xx = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return (
      p.statusCode >= 400 &&
      p.statusCode < 500 &&
      before.statusCode >= 200 &&
      before.statusCode < 400
    );
  });
  if (now4xx.length > 0) {
    const share = pct(now4xx.length, total);
    push({
      signal: "pages_4xx",
      severite: share >= 10 ? "critique" : "important",
      pages: now4xx.map(ref),
      explication: `${now4xx.length} page${now4xx.length > 1 ? "s" : ""} qui répondai${now4xx.length > 1 ? "ent" : "t"} correctement renvoie${now4xx.length > 1 ? "nt" : ""} désormais une erreur 4xx (${share.toFixed(0)} % des pages suivies).`,
      correctif: CORRECTIFS.pages_4xx,
      causeKey: "pages_4xx",
    });
  }

  // ── 🔴 Sitemap cassé ──────────────────────────────────────────
  if (prev.site.sitemap.ok) {
    const brokenNow = !next.site.sitemap.ok;
    const shrunk =
      next.site.sitemap.ok &&
      prev.site.sitemap.urlCount > 0 &&
      next.site.sitemap.urlCount < prev.site.sitemap.urlCount * 0.7;
    if (brokenNow || shrunk) {
      push({
        signal: "sitemap_broken",
        severite: "critique",
        pages: [
          {
            url: next.site.sitemap.url ?? new URL("/sitemap.xml", homeUrl(next)).toString(),
            poids: 10,
          },
        ],
        explication: brokenNow
          ? "Le sitemap du site est devenu inaccessible ou vide."
          : `Le sitemap a perdu ${(100 - pct(next.site.sitemap.urlCount, prev.site.sitemap.urlCount)).toFixed(0)} % de ses URLs (${prev.site.sitemap.urlCount} → ${next.site.sitemap.urlCount}).`,
        correctif: CORRECTIFS.sitemap_broken,
        causeKey: "sitemap_broken",
      });
    }
  }

  // ── 🟠 Core Web Vitals dégradés ───────────────────────────────
  for (const [url, cwv] of Object.entries(next.site.cwv)) {
    const before = prev.site.cwv[url];
    if (!before || cwv.lcpMs === null || before.lcpMs === null) continue;
    const crossed = before.lcpMs <= 2500 && cwv.lcpMs > 2500;
    const degraded = cwv.lcpMs > before.lcpMs * 1.3;
    if (crossed || degraded) {
      push({
        signal: "cwv_degraded",
        severite: "important",
        pages: [{ url, poids: poidsPage(url) }],
        explication: `Le temps de chargement (LCP) de ${url} est passé de ${(before.lcpMs / 1000).toFixed(1)} s à ${(cwv.lcpMs / 1000).toFixed(1)} s.`,
        correctif: CORRECTIFS.cwv_degraded,
        causeKey: `cwv_degraded:${url}`,
      });
    }
  }

  // ── 🟠 Chaînes/boucles de redirection sur pages clés ──────────
  const chained = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return (
      poidsPage(p.url, p.clickDepth) >= 3 &&
      p.redirectChain.length >= 2 &&
      before.redirectChain.length < 2
    );
  });
  if (chained.length > 0) {
    push({
      signal: "redirect_chain",
      severite: "important",
      pages: chained.map(ref),
      explication: `${chained.length} page${chained.length > 1 ? "s" : ""} clé${chained.length > 1 ? "s" : ""} pass${chained.length > 1 ? "ent" : "e"} désormais par une chaîne de plusieurs redirections avant d'être atteinte${chained.length > 1 ? "s" : ""}.`,
      correctif: CORRECTIFS.redirect_chain,
      causeKey: "redirect_chain",
    });
  }

  // ── 🟠 Titres/H1 perdus ou dupliqués (≥5 %) ───────────────────
  const lostTitle = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return (
      p.statusCode === 200 &&
      ((before.title && !p.title) || (before.h1 && !p.h1))
    );
  });
  const duplicatedTitles = findNewDuplicates(
    common,
    prevPages,
    (p) => p.title
  );
  const titleIssues = dedupePages([...lostTitle, ...duplicatedTitles]);
  if (titleIssues.length > 0 && pct(titleIssues.length, total) >= 5) {
    push({
      signal: "titles_h1_lost",
      severite: "important",
      pages: titleIssues.map(ref),
      explication: `${titleIssues.length} page${titleIssues.length > 1 ? "s" : ""} (${pct(titleIssues.length, total).toFixed(0)} % du site suivi) ont perdu leur balise <title> ou <h1>, ou partagent désormais un titre identique.`,
      correctif: CORRECTIFS.titles_h1_lost,
      causeKey: "titles_h1_lost",
    });
  }

  // ── 🟠 Contenu devenu JS-only (pages clés) ────────────────────
  const jsOnly = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return (
      p.statusCode === 200 &&
      poidsPage(p.url, p.clickDepth) >= 3 &&
      before.textLength > 500 &&
      p.textLength < before.textLength * 0.2
    );
  });
  if (jsOnly.length > 0) {
    push({
      signal: "content_js_only",
      severite: "important",
      pages: jsOnly.map(ref),
      explication: `Le contenu texte de ${jsOnly.length} page${jsOnly.length > 1 ? "s" : ""} clé${jsOnly.length > 1 ? "s" : ""} a quasiment disparu du HTML brut : il n'est probablement plus rendu que par JavaScript.`,
      correctif: CORRECTIFS.content_js_only,
      causeKey: "content_js_only",
    });
  }

  // ── 🟠 Données structurées cassées ────────────────────────────
  const sdBroken = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return (
      p.statusCode === 200 &&
      before.structuredData.valid &&
      before.structuredData.types.length > 0 &&
      !p.structuredData.valid
    );
  });
  if (sdBroken.length > 0) {
    push({
      signal: "structured_data_broken",
      severite: "important",
      pages: sdBroken.map(ref),
      explication: `Les données structurées (JSON-LD) de ${sdBroken.length} page${sdBroken.length > 1 ? "s" : ""} sont devenues invalides.`,
      correctif: CORRECTIFS.structured_data_broken,
      causeKey: "structured_data_broken",
    });
  }

  // ── 🟠 Liens internes cassés (≥5 nouveaux) ────────────────────
  const brokenLinks = findNewBrokenLinks(prev, next, prevPages, nextPages);
  if (brokenLinks.size >= 5) {
    const sources = [...brokenLinks.values()].flat();
    push({
      signal: "internal_links_broken",
      severite: "important",
      pages: dedupePages(sources).map(ref),
      explication: `${brokenLinks.size} nouveaux liens internes pointent vers des pages en erreur.`,
      correctif: CORRECTIFS.internal_links_broken,
      causeKey: "internal_links_broken",
    });
  }

  // ── 🟠 llms.txt cassé/disparu ─────────────────────────────────
  if (
    prev.site.llmsTxt.present &&
    (!next.site.llmsTxt.present || (prev.site.llmsTxt.valid && !next.site.llmsTxt.valid))
  ) {
    push({
      signal: "llmstxt_broken",
      severite: "important",
      pages: [{ url: new URL("/llms.txt", homeUrl(next)).toString(), poids: 5 }],
      explication: !next.site.llmsTxt.present
        ? "Le fichier llms.txt a disparu du site."
        : "Le fichier llms.txt est devenu invalide (vide ou sans structure lisible).",
      correctif: CORRECTIFS.llmstxt_broken,
      causeKey: "llmstxt_broken",
    });
  }

  // ── 🟠 Contenu dupliqué (nouveau cluster) ─────────────────────
  const dupClusters = findNewDuplicateClusters(prev.pages, next.pages);
  if (dupClusters.length > 0) {
    const pages = dupClusters.flat();
    push({
      signal: "duplicate_content",
      severite: "important",
      pages: pages.map(ref),
      explication: `${dupClusters.length} nouveau${dupClusters.length > 1 ? "x" : ""} groupe${dupClusters.length > 1 ? "s" : ""} de pages au contenu identique ${dupClusters.length > 1 ? "sont apparus" : "est apparu"} (${pages.length} pages concernées).`,
      correctif: CORRECTIFS.duplicate_content,
      causeKey: "duplicate_content",
    });
  }

  // ── 🟠 Poids de page +50 % ────────────────────────────────────
  const heavier = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return (
      p.statusCode === 200 &&
      poidsPage(p.url, p.clickDepth) >= 3 &&
      before.sizeBytes > 50_000 &&
      p.sizeBytes > before.sizeBytes * 1.5
    );
  });
  if (heavier.length > 0) {
    push({
      signal: "page_weight_increase",
      severite: "important",
      pages: heavier.map(ref),
      explication: `${heavier.length} page${heavier.length > 1 ? "s" : ""} clé${heavier.length > 1 ? "s ont" : " a"} vu son poids augmenter de plus de 50 % depuis le dernier crawl.`,
      correctif: CORRECTIFS.page_weight_increase,
      causeKey: "page_weight_increase",
    });
  }

  // ── 🟠 Meta descriptions perdues (≥10 %) ──────────────────────
  const lostMeta = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return p.statusCode === 200 && before.metaDescription && !p.metaDescription;
  });
  if (lostMeta.length > 0 && pct(lostMeta.length, total) >= 10) {
    push({
      signal: "meta_description_lost",
      severite: "important",
      pages: lostMeta.map(ref),
      explication: `${lostMeta.length} pages (${pct(lostMeta.length, total).toFixed(0)} % du site suivi) ont perdu leur meta description.`,
      correctif: CORRECTIFS.meta_description_lost,
      causeKey: "meta_description_lost",
    });
  }

  // ── 🟠 Pages orphelines apparues ──────────────────────────────
  const orphans = findNewOrphans(prev.pages, next.pages);
  if (orphans.length > 0) {
    push({
      signal: "orphan_pages",
      severite: "important",
      pages: orphans.map(ref),
      explication: `${orphans.length} page${orphans.length > 1 ? "s" : ""} ne reçoi${orphans.length > 1 ? "vent" : "t"} plus aucun lien interne : ${orphans.length > 1 ? "elles sont devenues orphelines" : "elle est devenue orpheline"}.`,
      correctif: CORRECTIFS.orphan_pages,
      causeKey: "orphan_pages",
    });
  }

  // ── ⚪ Infos : nouvelles pages, améliorations ──────────────────
  const newPages = [...nextPages.values()].filter(
    (p) => !prevPages.has(p.url) && p.statusCode === 200
  );
  if (newPages.length > 0) {
    push({
      signal: "new_pages",
      severite: "info",
      pages: newPages.map(ref),
      explication: `${newPages.length} nouvelle${newPages.length > 1 ? "s" : ""} page${newPages.length > 1 ? "s" : ""} détectée${newPages.length > 1 ? "s" : ""} sur le site.`,
      correctif: "Rien à faire — information de suivi.",
      causeKey: "new_pages",
    });
  }

  const fixed = common.filter((p) => {
    const before = prevPages.get(p.url)!;
    return (
      (before.noindex && !p.noindex && p.statusCode === 200) ||
      (before.statusCode >= 400 && p.statusCode === 200)
    );
  });
  if (fixed.length > 0) {
    push({
      signal: "improvement",
      severite: "info",
      pages: fixed.map(ref),
      explication: `${fixed.length} page${fixed.length > 1 ? "s" : ""} précédemment en erreur ou désindexée${fixed.length > 1 ? "s" : ""} répond${fixed.length > 1 ? "ent" : ""} à nouveau normalement.`,
      correctif: "Rien à faire — amélioration détectée.",
      causeKey: "improvement",
    });
  }

  return events;
}

function homeUrl(crawl: CrawlResult): string {
  const home = crawl.pages.find((p) => poidsPage(p.url) === 10);
  if (home) return new URL(home.url).origin;
  if (crawl.pages.length > 0) return new URL(crawl.pages[0].url).origin;
  return "https://site-inconnu.invalid";
}

function isExternalCanonical(p: PageSnapshot): boolean {
  if (!p.canonical) return false;
  try {
    const strip = (h: string) => h.replace(/^www\./, "");
    return strip(new URL(p.canonical).hostname) !== strip(new URL(p.url).hostname);
  } catch {
    return false;
  }
}

function dedupePages(pages: PageSnapshot[]): PageSnapshot[] {
  const seen = new Set<string>();
  return pages.filter((p) => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
}

/** Pages dont la valeur (ex. title) est devenue dupliquée alors qu'elle ne l'était pas. */
function findNewDuplicates(
  common: PageSnapshot[],
  prevPages: Map<string, PageSnapshot>,
  key: (p: PageSnapshot) => string | null
): PageSnapshot[] {
  const countNow = new Map<string, PageSnapshot[]>();
  for (const p of common) {
    const k = key(p);
    if (!k) continue;
    countNow.set(k, [...(countNow.get(k) ?? []), p]);
  }
  const countBefore = new Map<string, number>();
  for (const p of prevPages.values()) {
    const k = key(p);
    if (!k) continue;
    countBefore.set(k, (countBefore.get(k) ?? 0) + 1);
  }
  const out: PageSnapshot[] = [];
  for (const [k, pages] of countNow) {
    if (pages.length > 1 && (countBefore.get(k) ?? 0) <= 1) out.push(...pages);
  }
  return out;
}

/** Liens internes (cible en erreur) nouveaux par rapport au crawl précédent. */
function findNewBrokenLinks(
  prev: CrawlResult,
  next: CrawlResult,
  prevPages: Map<string, PageSnapshot>,
  nextPages: Map<string, PageSnapshot>
): Map<string, PageSnapshot[]> {
  const isBroken = (pages: Map<string, PageSnapshot>, url: string): boolean => {
    const target = pages.get(url);
    return target !== undefined && target.statusCode >= 400;
  };
  const brokenBefore = new Set<string>();
  for (const p of prev.pages) {
    for (const link of p.internalLinksOut) {
      if (isBroken(prevPages, link)) brokenBefore.add(`${p.url}→${link}`);
    }
  }
  const out = new Map<string, PageSnapshot[]>();
  for (const p of next.pages) {
    for (const link of p.internalLinksOut) {
      const key = `${p.url}→${link}`;
      if (isBroken(nextPages, link) && !brokenBefore.has(key)) {
        out.set(key, [...(out.get(key) ?? []), p]);
      }
    }
  }
  return out;
}

/** Nouveaux clusters (≥2 pages, hash identique) absents du crawl précédent. */
function findNewDuplicateClusters(
  prevPages: PageSnapshot[],
  nextPages: PageSnapshot[]
): PageSnapshot[][] {
  const cluster = (pages: PageSnapshot[]): Map<string, PageSnapshot[]> => {
    const m = new Map<string, PageSnapshot[]>();
    for (const p of pages) {
      if (p.statusCode !== 200 || p.textLength < 200) continue;
      m.set(p.contentHash, [...(m.get(p.contentHash) ?? []), p]);
    }
    return m;
  };
  const before = cluster(prevPages);
  const now = cluster(nextPages);
  const out: PageSnapshot[][] = [];
  for (const [hash, pages] of now) {
    if (pages.length >= 2 && (before.get(hash)?.length ?? 0) < 2) {
      out.push(pages);
    }
  }
  return out;
}

/** Pages en sitemap qui recevaient des liens internes et n'en reçoivent plus. */
function findNewOrphans(
  prevPages: PageSnapshot[],
  nextPages: PageSnapshot[]
): PageSnapshot[] {
  const inbound = (pages: PageSnapshot[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const p of pages) {
      for (const link of p.internalLinksOut) {
        if (link === p.url) continue;
        m.set(link, (m.get(link) ?? 0) + 1);
      }
    }
    return m;
  };
  const before = inbound(prevPages);
  const now = inbound(nextPages);
  const prevUrls = new Set(prevPages.map((p) => p.url));
  return nextPages.filter(
    (p) =>
      p.statusCode === 200 &&
      p.inSitemap &&
      prevUrls.has(p.url) &&
      (before.get(p.url) ?? 0) > 0 &&
      (now.get(p.url) ?? 0) === 0
  );
}
