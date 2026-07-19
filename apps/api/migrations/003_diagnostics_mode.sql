-- Découplage provider / mode : un Diagnostic peut être agentique (agent-sdk,
-- Anthropic ou xAI via endpoint compatible) ou chat (analyse du digest
-- crawler). NULL = mode par défaut du provider.
alter table diagnostics
  add column if not exists mode text
    check (mode in ('agent-sdk', 'chat'));
