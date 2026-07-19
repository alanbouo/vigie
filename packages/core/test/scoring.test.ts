import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ampleur,
  fraicheur,
  scoreFinding,
  top3,
  SCORE_PLANCHER,
  type Finding,
} from "@vigie/core";

const SITE_ID = randomUUID();

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: randomUUID(),
    site_id: SITE_ID,
    source: "garde",
    pilier: "seo",
    signal: "meta_description_lost",
    severite: "important",
    pages: [{ url: "https://ex.com/page", poids: 1 }],
    explication: "explication",
    correctif: "correctif",
    effort: 1,
    detecte_le: new Date(),
    confirme: true,
    statut: "ouvert",
    ...overrides,
  };
}

describe("formule de score (§6.1)", () => {
  it("score = impact × ampleur × fraîcheur × confiance / effort", () => {
    const f = finding({
      signal: "noindex_added",
      severite: "critique",
      pages: [{ url: "https://ex.com/", poids: 10 }],
      effort: 1,
    });
    const s = scoreFinding(f, new Date());
    // 10 × log10(11) × 1.5 × 1.0 / 1
    expect(s.score).toBeCloseTo(10 * Math.log10(11) * 1.5, 1);
    expect(s.facteurs.impactBase).toBe(10);
  });

  it("l'ampleur est logarithmique : le massif-mineur n'écrase pas le fatal-ponctuel", () => {
    const massifMineur = finding({
      signal: "meta_description_lost",
      pages: Array.from({ length: 200 }, (_, i) => ({
        url: `https://ex.com/p${i}`,
        poids: 1,
      })),
    });
    const fatalPonctuel = finding({
      signal: "noindex_added",
      severite: "critique",
      pages: [{ url: "https://ex.com/", poids: 10 }],
    });
    expect(scoreFinding(fatalPonctuel).score).toBeGreaterThan(
      scoreFinding(massifMineur).score
    );
  });

  it("la fraîcheur décroît avec l'âge (le Top 3 doit vivre)", () => {
    const now = new Date("2026-07-18");
    expect(fraicheur(new Date("2026-07-15"), now)).toBe(1.5);
    expect(fraicheur(new Date("2026-07-01"), now)).toBe(1.0);
    expect(fraicheur(new Date("2026-05-01"), now)).toBe(0.6);
  });

  it("vu 1 fois = confiance moitié", () => {
    const confirmed = scoreFinding(finding({ confirme: true }));
    const unconfirmed = scoreFinding(finding({ confirme: false }));
    expect(unconfirmed.score).toBeCloseTo(confirmed.score / 2, 5);
  });

  it("ampleur utilise log10(1 + somme des poids)", () => {
    const f = finding({
      pages: [
        { url: "https://ex.com/", poids: 10 },
        { url: "https://ex.com/cat", poids: 5 },
      ],
    });
    expect(ampleur(f)).toBeCloseTo(Math.log10(16), 5);
  });
});

describe("garde-fous du Top 3 (§6.2)", () => {
  it("plancher : aucun score > 2.0 → RAS, jamais de podium forcé", () => {
    const faible = finding({
      signal: "orphan_pages",
      pages: [{ url: "https://ex.com/vieux", poids: 0.2 }],
      detecte_le: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      effort: 5,
      confirme: false,
    });
    const result = top3([faible]);
    expect(scoreFinding(faible).score).toBeLessThanOrEqual(SCORE_PLANCHER);
    expect(result.ras).toBe(true);
    expect(result.top).toHaveLength(0);
  });

  it("override : un 🔴 confirmé entre d'office au podium", () => {
    const critique = finding({
      signal: "ssl_expiring",
      severite: "critique",
      confirme: true,
      // Vieux et petit : score bas, mais critique confirmé.
      detecte_le: new Date(Date.now() - 90 * 24 * 3600 * 1000),
      effort: 5,
      pages: [{ url: "https://ex.com/tech", poids: 0.2 }],
    });
    const result = top3([critique]);
    expect(result.ras).toBe(false);
    expect(result.top[0].finding.signal).toBe("ssl_expiring");
  });

  it("diversité : max 2 signaux d'une même famille au podium", () => {
    const contenus = ["titles_h1_lost", "meta_description_lost", "duplicate_content"].map(
      (signal) =>
        finding({
          signal,
          pages: Array.from({ length: 30 }, (_, i) => ({
            url: `https://ex.com/${signal}/${i}`,
            poids: 3,
          })),
        })
    );
    const maillage = finding({
      signal: "internal_links_broken",
      pages: [{ url: "https://ex.com/a", poids: 3 }],
    });
    const result = top3([...contenus, maillage]);
    const familles = result.top.map((s) => s.finding.signal);
    // Les 3 signaux "contenu" ne peuvent pas occuper tout le podium.
    expect(familles).toContain("internal_links_broken");
  });

  it("acquitté = exclu du calcul", () => {
    const acquitte = finding({
      signal: "noindex_added",
      severite: "critique",
      statut: "acquitte",
    });
    const result = top3([acquitte]);
    expect(result.ras).toBe(true);
    expect(result.scored).toHaveLength(0);
  });

  it("les findings info ne participent jamais au podium", () => {
    const info = finding({ signal: "new_pages", severite: "info" });
    const result = top3([info]);
    expect(result.ras).toBe(true);
  });
});
