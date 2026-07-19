import type { Finding } from "./findings.js";
import { getSignal } from "./signals.js";

/**
 * Format d'une alerte (§6.4) — invariant :
 * Quoi a changé → Pourquoi ça compte → Comment corriger → [Si c'est voulu : acquitter]
 * Une cause, un impact, un correctif. Jamais de score exposé, jamais de liste de 200 items.
 */

export interface AlerteContenu {
  sujet: string;
  quoi: string;
  pourquoi: string;
  comment: string;
  acquitterUrl: string;
  diagnosticUrl?: string;
  pagesResume: string;
}

const MAX_URLS_AFFICHEES = 5;

export function resumePages(finding: Finding): string {
  const urls = finding.pages.map((p) => p.url);
  if (urls.length === 0) return "";
  if (urls.length <= MAX_URLS_AFFICHEES) return urls.join("\n");
  return (
    urls.slice(0, MAX_URLS_AFFICHEES).join("\n") +
    `\n… et ${urls.length - MAX_URLS_AFFICHEES} autres pages (regroupées par cause)`
  );
}

export function construireAlerte(
  finding: Finding,
  opts: { appBaseUrl: string; siteUrl: string; proposerDiagnostic?: boolean }
): AlerteContenu {
  const def = getSignal(finding.signal);
  const emoji = finding.severite === "critique" ? "🔴" : "🟠";
  const nbPages = finding.pages.length;
  const suffixePages = nbPages > 1 ? ` (${nbPages} pages)` : "";

  return {
    sujet: `${emoji} ${def.label} — ${opts.siteUrl}${suffixePages}`,
    quoi: finding.explication,
    pourquoi: pourquoiCaCompte(finding.signal),
    comment: finding.correctif,
    acquitterUrl: `${opts.appBaseUrl}/findings/${finding.finding_id}/acquitter`,
    // Déclenchement intelligent (§1.2) : une alerte critique propose le Diagnostic en un clic.
    diagnosticUrl:
      opts.proposerDiagnostic && finding.severite === "critique"
        ? `${opts.appBaseUrl}/sites/${finding.site_id}/diagnostic?depuis=${finding.finding_id}`
        : undefined,
    pagesResume: resumePages(finding),
  };
}

/** Explications « pourquoi ça compte », sans jargon, par signal. */
function pourquoiCaCompte(signal: string): string {
  const table: Record<string, string> = {
    noindex_added:
      "Ces pages demandent explicitement à Google de les retirer de son index. Si ce n'est pas voulu, elles vont disparaître des résultats de recherche — et le trafic avec.",
    robots_blocking_added:
      "Le fichier robots.txt interdit désormais aux moteurs de recherche de visiter ces pages. Google ne peut plus les lire ni les maintenir dans ses résultats.",
    ai_crawler_blocked:
      "Les assistants IA (ChatGPT, Claude, Perplexity, Gemini) ne peuvent plus lire le site. Il va progressivement disparaître de leurs réponses, là où de plus en plus de clients cherchent.",
    site_down_5xx:
      "Le site renvoie des erreurs serveur : les visiteurs n'y accèdent plus, et si ça dure, Google déclasse les pages concernées.",
    ssl_expiring:
      "Sans certificat valide, les navigateurs afficheront un avertissement de sécurité bloquant. Les visiteurs fuient, et Google pénalise les sites non sécurisés.",
    canonical_external:
      "Ces pages déclarent qu'une autre — sur un autre domaine — est la version officielle. Google risque de créditer ce domaine externe à leur place.",
    pages_4xx:
      "Ces pages renvoient une erreur : les visiteurs tombent sur une page introuvable et Google finit par les retirer de l'index.",
    sitemap_broken:
      "Le sitemap est la carte que Google utilise pour découvrir les pages. Cassé, les nouvelles pages mettront beaucoup plus de temps à être trouvées.",
    cwv_degraded:
      "Le site est devenu nettement plus lent. La lenteur fait fuir les visiteurs et pèse sur le classement Google.",
    redirect_chain:
      "Chaque redirection en chaîne ralentit la page et dilue la valeur SEO transmise. Les boucles rendent la page carrément inaccessible.",
    titles_h1_lost:
      "Le titre est le premier signal que Google lit pour comprendre une page — et ce que l'internaute voit dans les résultats. Sans titre, le classement et le taux de clic chutent.",
    content_js_only:
      "Le contenu n'apparaît plus dans le HTML : il n'est visible qu'après exécution du JavaScript. Une partie des robots (dont la plupart des IA) ne le voit plus du tout.",
    structured_data_broken:
      "Les données structurées alimentent les résultats enrichis (étoiles, prix, FAQ…). Cassées, ces mises en avant disparaissent des résultats.",
    internal_links_broken:
      "Des liens internes mènent à des pages en erreur : mauvaise expérience visiteur et signaux négatifs pour l'exploration du site.",
    llmstxt_broken:
      "Le fichier llms.txt guide les IA vers le contenu important du site. Cassé, il n'aide plus à la visibilité dans leurs réponses.",
    duplicate_content:
      "Plusieurs pages présentent le même contenu : Google ne sait plus laquelle classer et peut les déprécier toutes.",
    page_weight_increase:
      "Des pages sont devenues nettement plus lourdes : chargement plus lent, visiteurs qui abandonnent, et signal négatif pour Google.",
    meta_description_lost:
      "Sans meta description, Google improvise le texte affiché sous le titre dans les résultats — souvent moins engageant, donc moins de clics.",
    orphan_pages:
      "Ces pages ne reçoivent plus aucun lien interne : les visiteurs ne peuvent plus les trouver en naviguant, et Google les considère comme secondaires.",
    ai_visibility_lost:
      "Le site n'apparaît plus dans les réponses des assistants IA sur des questions où il était cité. Cette visibilité part chez les concurrents.",
    ai_source_gap:
      "Les IA citent massivement une source où le site est absent. C'est une cible concrète pour regagner de la visibilité dans leurs réponses.",
  };
  return (
    table[signal] ??
    "Ce changement peut affecter la visibilité du site dans les moteurs de recherche et les réponses des IA."
  );
}

export function alerteEnTexte(a: AlerteContenu): string {
  const lignes = [
    `CE QUI A CHANGÉ`,
    a.quoi,
    a.pagesResume ? `\nPages concernées :\n${a.pagesResume}` : "",
    ``,
    `POURQUOI ÇA COMPTE`,
    a.pourquoi,
    ``,
    `COMMENT CORRIGER`,
    a.comment,
    ``,
    `Si ce changement est voulu : ${a.acquitterUrl}`,
  ];
  if (a.diagnosticUrl) {
    lignes.push(
      ``,
      `Pour comprendre en profondeur : lancer un Diagnostic → ${a.diagnosticUrl}`
    );
  }
  return lignes.filter((l) => l !== "").join("\n");
}
