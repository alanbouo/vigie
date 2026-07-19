/**
 * Poids SEO d'une page (§6.1) : home=10, catégorie=5, produit/article=3,
 * profonde=1, technique=0.2.
 * Classification heuristique par URL + profondeur de clic quand elle est connue.
 */

export const POIDS = {
  home: 10,
  categorie: 5,
  produit: 3,
  profonde: 1,
  technique: 0.2,
} as const;

const TECHNICAL_PATTERNS =
  /(mentions-legales|legal|privacy|politique-de-confidentialite|cgv|cgu|terms|conditions|login|signin|signup|register|panier|cart|checkout|compte|account|password|search|recherche|tag\/|wp-admin|feed|rss)/i;

const CATEGORY_PATTERNS =
  /(^\/(categorie|category|categories|collections?|boutique|shop|blog|actualites|news|produits|products|services)\/?$)|(^\/(categorie|category|collections?)\/[^/]+\/?$)/i;

const PRODUCT_PATTERNS =
  /(\/(produit|product|article|post|fiche)s?\/)|(\/blog\/[^/]+)|(\/p\/)/i;

export function poidsPage(url: string, clickDepth?: number): number {
  let path: string;
  try {
    path = new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return POIDS.profonde;
  }

  if (path === "/") return POIDS.home;
  if (TECHNICAL_PATTERNS.test(path)) return POIDS.technique;

  const segments = path.split("/").filter(Boolean);

  if (CATEGORY_PATTERNS.test(path)) return POIDS.categorie;
  if (PRODUCT_PATTERNS.test(path)) return POIDS.produit;

  // Un premier niveau de navigation ressemble à une page de section.
  if (segments.length === 1 && (clickDepth === undefined || clickDepth <= 1)) {
    return POIDS.categorie;
  }
  if (segments.length === 2) return POIDS.produit;
  if (clickDepth !== undefined && clickDepth >= 3) return POIDS.profonde;
  return POIDS.profonde;
}
