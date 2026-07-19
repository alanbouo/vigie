import { createHmac, timingSafeEqual } from "node:crypto";
import { one, q } from "./db.js";
import { env } from "./env.js";
import { CREDIT_PACKS, PLANS } from "./plans.js";

/**
 * Stripe (§1.2) : abonnements (la Garde) + crédits (le Diagnostic).
 * Client HTTP minimal (pas de SDK) : création de sessions Checkout et
 * vérification de signature des webhooks.
 */

async function stripePost(
  endpoint: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(`Stripe ${endpoint} : ${err?.message ?? res.status}`);
  }
  return json;
}

/** Session Checkout pour un abonnement Garde (palier) ou un pack de crédits. */
export async function createCheckoutSession(opts: {
  agencyId: string;
  type: "abonnement" | "credits";
  planOrPack: string;
}): Promise<{ url: string }> {
  if (!env.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY absent : facturation non configurée.");
  }

  const base: Record<string, string> = {
    "metadata[agency_id]": opts.agencyId,
    "metadata[type]": opts.type,
    "metadata[plan_or_pack]": opts.planOrPack,
    success_url: `${env.appBaseUrl}/billing/success`,
    cancel_url: `${env.appBaseUrl}/billing/cancel`,
  };

  if (opts.type === "abonnement") {
    const plan = PLANS[opts.planOrPack];
    if (!plan) throw new Error(`Palier inconnu : ${opts.planOrPack}`);
    const session = await stripePost("checkout/sessions", {
      ...base,
      mode: "subscription",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(plan.prixMensuelEur * 100),
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][price_data][product_data][name]": `Vigie — La Garde (${plan.label})`,
      "line_items[0][quantity]": "1",
    });
    return { url: session.url as string };
  }

  const pack = CREDIT_PACKS[opts.planOrPack];
  if (!pack) throw new Error(`Pack inconnu : ${opts.planOrPack}`);
  const session = await stripePost("checkout/sessions", {
    ...base,
    mode: "payment",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(pack.prixEur * 100),
    "line_items[0][price_data][product_data][name]": `Vigie — ${pack.label}`,
    "line_items[0][quantity]": "1",
  });
  return { url: session.url as string };
}

/** Vérification de la signature Stripe-Signature (HMAC-SHA256 sur t.payload). */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300
): boolean {
  const parts = new Map(
    signatureHeader.split(",").map((p) => {
      const [k, ...v] = p.split("=");
      return [k.trim(), v.join("=")] as const;
    })
  );
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(signature, "utf-8");
  return a.length === b.length && timingSafeEqual(a, b);
}

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: {
      id?: string;
      metadata?: Record<string, string>;
      subscription?: string;
      status?: string;
    };
  };
}

/** Traite un événement webhook Stripe (déjà vérifié). Idempotent par event id. */
export async function handleStripeEvent(event: StripeEvent): Promise<void> {
  const obj = event.data.object;
  const agencyId = obj.metadata?.agency_id;

  if (event.type === "checkout.session.completed" && agencyId) {
    const type = obj.metadata?.type;
    const planOrPack = obj.metadata?.plan_or_pack ?? "";

    if (type === "credits") {
      const pack = CREDIT_PACKS[planOrPack];
      if (!pack) return;
      // Idempotence : contrainte unique sur stripe_event_id.
      await q(
        `insert into credits (agency_id, delta, motif, stripe_event_id)
         values ($1, $2, $3, $4)
         on conflict (stripe_event_id) do nothing`,
        [agencyId, pack.credits, `Achat ${pack.label}`, event.id]
      );
    } else if (type === "abonnement") {
      const plan = PLANS[planOrPack];
      if (!plan) return;
      await q(
        `insert into subscriptions (agency_id, stripe_subscription_id, palier, statut)
         values ($1, $2, $3, 'active')
         on conflict (stripe_subscription_id)
         do update set palier = excluded.palier, statut = 'active', updated_at = now()`,
        [agencyId, obj.subscription ?? obj.id, plan.palier]
      );
      await q(`update sites set palier = $2 where agency_id = $1`, [
        agencyId,
        plan.palier,
      ]);
    }
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = obj.id;
    if (!sub) return;
    await q(
      `update subscriptions set statut = 'canceled', updated_at = now()
       where stripe_subscription_id = $1`,
      [sub]
    );
    return;
  }
}

export async function abonnementActif(agencyId: string): Promise<boolean> {
  const row = await one(
    `select 1 from subscriptions where agency_id = $1 and statut = 'active'`,
    [agencyId]
  );
  return row !== null;
}
