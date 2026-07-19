-- Multi-LLM : chaque Diagnostic mémorise le provider qui l'a exécuté
-- (anthropic = Agent SDK + claude-seo ; xai / openai-compatible = mode chat
-- sur données du crawler). NULL = provider par défaut du serveur.
alter table diagnostics
  add column if not exists provider text
    check (provider in ('anthropic', 'xai', 'openai-compatible'));
