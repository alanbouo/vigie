---
name: claude-seo
description: Audit SEO + GEO/AEO complet d'un site web — indexabilité, balisage, données structurées, maillage interne, accessibilité aux crawlers IA, optimisation pour les moteurs de réponse (Perplexity, AI Overviews, ChatGPT). Utiliser pour tout Diagnostic de santé SEO ou de visibilité IA d'un site.
---

# claude-seo — Diagnostic SEO + GEO/AEO

> Fork interne de claude-seo (licence MIT — attribution conservée, voir LICENSE).
> Version pinnée : voir PINNED_COMMIT. Mise à jour via scripts/vendor-claude-seo.sh.

## Méthode d'audit

Procède dans cet ordre. Pour chaque étape, note les constats (une cause, un
impact, un correctif) — tu les regrouperas à la fin.

### 1. Fondations techniques
- Récupère `robots.txt` : règles pour les moteurs de recherche ET pour les
  crawlers IA (GPTBot, ClaudeBot, PerplexityBot, Google-Extended).
- Récupère `llms.txt` : présence, validité, qualité du contenu référencé.
- Récupère le sitemap (déclaré dans robots.txt ou `/sitemap.xml`) : accessibilité,
  nombre d'URLs, cohérence avec le site réel.
- Vérifie le statut HTTP de la home et des pages clés, les chaînes de
  redirections, le HTTPS.

### 2. Indexabilité page par page
Sur l'échantillon de pages (respecter le plafond de pages donné dans la mission) :
- meta robots / X-Robots-Tag (noindex, nofollow) ;
- canonical (auto-référent ? vers un autre domaine ?) ;
- `<title>` (présent, unique, descriptif), `<h1>`, meta description ;
- données structurées JSON-LD (types, validité du JSON, adéquation au contenu).

### 3. Contenu et accessibilité IA (GEO/AEO)
- Le contenu principal est-il présent dans le HTML brut (sans JavaScript) ?
- Structure en réponses : les pages répondent-elles clairement à des questions
  (titres-questions, paragraphes autonomes, définitions, listes, tableaux) ?
- Entités et autorité : le site dit-il clairement qui il est, où, pour qui
  (pages à propos, mentions, schema Organization/LocalBusiness) ?
- Citabilité : les informations clés sont-elles formulées de façon qu'un moteur
  de réponse puisse les citer (chiffres sourcés, dates, faits vérifiables) ?

### 4. Maillage et architecture
- Profondeur de clic des pages importantes, pages orphelines, liens internes
  cassés, ancres descriptives.

### 5. Synthèse et plan d'action
- Regroupe les constats par cause (jamais 40 lignes pour 40 pages).
- Priorise par impact réel sur la visibilité, effort de correction croissant.
- Rédige sans jargon : chaque constat doit être compréhensible par le
  propriétaire du site.

## Règles de restitution

- Toujours produire les fichiers demandés dans la mission (`rapport.md`,
  `findings.json`) dans le dossier de sortie indiqué.
- `findings.json` : respecter STRICTEMENT le schéma fourni dans la mission.
- Le rapport est destiné à être re-brandé (white-label) : ne pas signer,
  ne pas mentionner d'outil interne.
- Français par défaut.
