import Fastify from "fastify";
import { env } from "./env.js";
import { registerRoutes } from "./routes.js";
import { startScheduler } from "./scheduler.js";
import { processQueue } from "./diagnosticService.js";

const app = Fastify({ logger: true, trustProxy: true });

// Conserve le corps brut (vérification de signature Stripe).
app.addHook("preParsing", async (req, _reply, payload) => {
  if (req.url === "/webhooks/stripe") {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf-8");
    req.rawBodyString = raw;
    const { Readable } = await import("node:stream");
    return Readable.from([raw]);
  }
  return payload;
});

registerRoutes(app);

app.setErrorHandler((err: unknown, _req, reply) => {
  const e = err as { validation?: unknown; name?: string; message?: string };
  if (e.validation || e.name === "ZodError") {
    return reply.code(400).send({ erreur: "Requête invalide.", details: e.message });
  }
  app.log.error(err);
  return reply.code(500).send({ erreur: "Erreur interne." });
});

async function main() {
  await app.listen({ port: env.port, host: "0.0.0.0" });
  if (env.cronEnabled) {
    startScheduler();
  }
  // Reprend les Diagnostics en attente au démarrage.
  void processQueue();
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
