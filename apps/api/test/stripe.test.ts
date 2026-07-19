import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "../src/stripe.js";

function sign(payload: string, secret: string, timestamp: number): string {
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

describe("vérification de signature Stripe", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accepte une signature valide", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(payload, sign(payload, secret, ts), secret)).toBe(true);
  });

  it("refuse une mauvaise signature", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(payload, sign(payload, "autre_secret", ts), secret)).toBe(false);
  });

  it("refuse un timestamp trop ancien (replay)", () => {
    const vieux = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyStripeSignature(payload, sign(payload, secret, vieux), secret)).toBe(false);
  });

  it("refuse un header malformé", () => {
    expect(verifyStripeSignature(payload, "garbage", secret)).toBe(false);
  });
});
