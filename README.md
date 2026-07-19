# Vigie — le système de santé de votre visibilité

> Sur Google **et** dans les réponses des IA. Surveillance continue, alertes
> quand ça casse, diagnostic profond quand ça compte.

Vigie est un système à deux étages pour agences web et freelances SEO
(10-50 sites clients) :

- **La Garde** (abonnement) — crawler déterministe : crawl hebdo complet,
  vérification quotidienne des signaux vitaux, moteur de diff, alertes
  immédiates sur les 🔴, Top 3 hebdo priorisé, Dossier historique.
- **Le Diagnostic** (crédits) — audit profond SEO + GEO/AEO mené par IA,
  rapport white-label + findings structurés. Multi-LLM : Claude Agent SDK +
  skill `claude-seo` (défaut), xAI/Grok, ou tout endpoint compatible OpenAI.
- **Visibilité IA** (v1.5, hors MVP) — suivi de présence dans les réponses IA
  (Perplexity, AI Overviews). Tables préparées, module non construit.

**Vocabulaire produit** : la Garde (surveillance) · l'Alerte (régression) ·
le Diagnostic (deep audit) · le Dossier (historique du site). L'ennemi :
le silence — la panne invisible.

## Architecture

```
apps/web        Next.js — landing + quick audit gratuit + dashboard agence
apps/api        Fastify — API, orchestrateur, scheduler, Stripe, emails
packages/core   Taxonomie des signaux (annexe A), findings unifiés (§5),
                scoring + Top 3 (§6), format d'alerte invariant
packages/garde  Moteur 1 : fetcher poli, parseur, snapshots page/site,
                crawl hebdo + quotidien léger, moteur de diff, confirmation
packages/diagnostic  Moteur 2 : worker Agent SDK + claude-seo, sortie JSON
                validée par schéma (retry), parsing → findings, coûts
infra/diagnostic-workspace  Workspace des jobs Diagnostic (.claude/skills)
```

**Principe clé : trois moteurs, un seul schéma de findings, un seul
algorithme de priorisation.**

### Le cycle complet

1. La Garde crawle (hebdo complet + quotidien léger, coût ~nul).
2. Le moteur de diff compare snapshot N à N-1 — **seul le changement compte**.
3. Anti-bruit : seuils relatifs, confirmation sur 2 crawls (sauf 🔴 francs),
   regroupement par cause, acquittement, « ✅ RAS » les semaines calmes.
4. Le scoring priorise : `score = (impact × ampleur × fraîcheur × confiance) / effort`,
   avec garde-fous (override critique, diversité, plancher 2.0).
5. L'Alerte (format invariant : quoi → pourquoi → comment → acquitter)
   propose le Diagnostic en un clic sur les 🔴.
6. Le Diagnostic tourne en job asynchrone, produit rapport white-label +
   findings JSON validés, facturé en crédits **uniquement s'il aboutit**.

### Choix du moteur IA du Diagnostic (multi-LLM)

Deux modes, même contrat de sortie (`rapport.md` + `findings.json` validé
par le schéma commun) — le dashboard et le Top 3 ne voient aucune différence :

| Provider | Mode | Fonctionnement |
|---|---|---|
| `anthropic` (défaut) | agent-sdk | Audit agentique complet : Claude Agent SDK + skill `claude-seo`, navigation autonome |
| `xai` | chat | Notre crawler collecte les données, Grok (`grok-4` par défaut, API `https://api.x.ai/v1`) analyse et rédige |
| `openai-compatible` | chat | Idem avec n'importe quel endpoint `/chat/completions` (`LLM_BASE_URL` + `LLM_MODEL` requis) |

Configuration serveur par `LLM_PROVIDER` (+ `XAI_API_KEY` / `LLM_API_KEY`,
`LLM_MODEL`, `LLM_BASE_URL`, voir `.env.example`). Surcharge possible par
job : `POST /sites/:id/diagnostic` accepte `{"provider": "xai"}`. Le
provider et le modèle utilisés sont journalisés dans `cost_log` avec les
tokens consommés (tarifs configurables via `LLM_COST_PER_MTOK_*`).

## Démarrage

Prérequis : Node ≥ 22, Postgres ≥ 14.

```bash
npm install                     # workspaces : core, garde, diagnostic, api
npm run build                   # tsc -b sur tous les packages
createdb vigie                  # ou utiliser DATABASE_URL existant
cp .env.example .env            # remplir les clés
npm run migrate                 # applique apps/api/migrations/*.sql
npm run dev:api                 # API sur :3001 (+ scheduler si CRON_ENABLED)

cd apps/web && npm install && npm run dev   # dashboard sur :3000
```

Tests (42, moteurs critiques : scoring, diff, robots, anti-SSRF, Stripe,
rate-limit) :

```bash
npm test
```

### Parcours de bout en bout (sans clé externe)

Sans `RESEND_API_KEY` les emails sont affichés en console ; sans
`ANTHROPIC_API_KEY` les jobs Diagnostic restent en file avec une erreur
explicite. Le reste fonctionne intégralement :

```bash
# 1. Créer une agence (la clé API est renvoyée une seule fois)
curl -X POST localhost:3001/agencies -H 'content-type: application/json' \
  -d '{"name":"Mon agence","email":"moi@agence.fr"}'

# 2. Mettre un site sous Garde (déclenche le Diagnostic d'onboarding offert)
curl -X POST localhost:3001/sites -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"url":"https://exemple.fr"}'

# 3. Crawl baseline puis crawls suivants (le diff ne parle que du changement)
curl -X POST localhost:3001/sites/$SITE/crawl -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"type":"hebdo"}'

# 4. Top 3 du site
curl localhost:3001/sites/$SITE/top3 -H "x-api-key: $KEY"
```

## API (résumé)

| Route | Rôle |
|---|---|
| `POST /agencies` | Inscription agence → clé API |
| `POST /sites` · `GET /sites` | Mise sous Garde (plafonds palier appliqués dans le code) |
| `GET /sites/:id/dossier` | Le Dossier : findings, Top 3, crawls, rapports, diagnostics |
| `POST /sites/:id/crawl` | Crawl manuel (hebdo/quotidien) |
| `POST /findings/:id/acquitter` · `/corriger` | « C'est voulu » → sort du calcul |
| `POST /sites/:id/diagnostic` | Lance un Diagnostic (1 crédit, consommé si abouti) |
| `POST /public/quick-audit` | Lead magnet public, rate-limité, anti-SSRF |
| `POST /billing/checkout` · `POST /webhooks/stripe` | Abonnements + crédits |
| `GET /internal/costs` | Coût par crawl / audit (unit economics, §10) |

## Scheduler

- **Lundi 05h00** : crawl hebdo complet + rapport (Top 3 ou « ✅ RAS »).
- **Tous les jours 06h30** : crawl quotidien léger (home, robots.txt +
  directives crawlers IA, sitemap, SSL, pages clés) — seuls les 🔴 alertent.
- **Toutes les 10 min** : reprise de la file des Diagnostics (crash-safe).

## Sécurité

- Anti-SSRF strict sur toute URL soumise (schémas, localhost, IP privées,
  résolution DNS) — `apps/api/src/ssrf.ts`.
- Crawler poli : user-agent `VigieBot/1.0` déclaré, robots.txt respecté,
  rate-limit ~1,4 req/s par hôte, timeouts, plafond de taille de réponse.
- Plafonds partout **dans le code** : pages/crawl (palier), tokens et tours
  par audit, rate-limit du quick audit public.
- Webhooks Stripe : signature HMAC vérifiée, idempotence par event id.
- Secrets uniquement en variables d'environnement.
- Skill `claude-seo` : fork vendorisé et pinné
  (`scripts/vendor-claude-seo.sh`), licence MIT conservée.

## État vs « Définition de prêt à vendre » (§12)

- [x] Un 🔴 injecté (noindex de test) déclenche findings + alerte —
  vérifié par smoke test de bout en bout sur fixture locale.
- [x] Semaine calme → « ✅ RAS » (plancher de score, jamais de podium forcé).
- [x] Quick audit public en lead magnet, rate-limité + anti-SSRF.
- [x] L'alerte critique propose le Diagnostic en un clic.
- [x] Abonnement + crédits Stripe ; plafonds appliqués côté code.
- [x] Coût par crawl et par audit dans `cost_log`.
- [ ] Faire tourner la Garde sur ≥10 sites réels 2 semaines sans fausse alerte.
- [ ] Valider un Diagnostic complet sur site réel (nécessite `ANTHROPIC_API_KEY`
  + calibrage du skill) ; rendu PDF du rapport (le MD/JSON sont produits).

## Feuille de route

- **v1.5** : module Visibilité IA (§8 de la spec) — panier de prompts,
  Perplexity Sonar + AI Overviews, extraction, share of voice, tendances
  confirmées sur 2 semaines. Schéma DB déjà en place
  (`prompt_baskets`, `visibility_runs`, `visibility_extractions`).
- **v2** : intégration Search Console / GA, rendu JS sur pages clés,
  CWV via API PageSpeed, exécution assistée des correctifs.
