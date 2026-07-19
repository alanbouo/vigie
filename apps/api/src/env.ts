/** Secrets et configuration en variables d'environnement serveur (§9). */
export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://vigie:vigie@localhost:5432/vigie",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  // Emails (Resend)
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "Vigie <alertes@vigie.app>",
  // Diagnostic (Claude Agent SDK)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  diagnosticWorkspace:
    process.env.DIAGNOSTIC_WORKSPACE ??
    new URL("../../../infra/diagnostic-workspace", import.meta.url).pathname,
  artifactsDir: process.env.ARTIFACTS_DIR ?? "/var/lib/vigie/artifacts",
  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  // Scheduler
  cronEnabled: (process.env.CRON_ENABLED ?? "true") === "true",
};
