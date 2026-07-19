"use client";

import { useState } from "react";
import { API_URL } from "../lib/api";

interface Constat {
  niveau: "ok" | "attention" | "critique";
  titre: string;
  detail: string;
}

export default function Landing() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [constats, setConstats] = useState<Constat[] | null>(null);

  async function lancerAudit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErreur(null);
    setConstats(null);
    try {
      const res = await fetch(`${API_URL}/public/quick-audit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.erreur ?? "Erreur");
      setConstats(json.constats);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Le système de santé de votre visibilité</h1>
      <p className="muted">
        Sur Google <em>et</em> dans les réponses des IA. La Garde surveille en
        continu, l&apos;Alerte vous prévient quand ça casse, le Diagnostic
        explique en profondeur quand ça compte.
      </p>

      <h2 id="quick-audit">Quick audit gratuit</h2>
      <div className="card">
        <form onSubmit={lancerAudit} className="row">
          <input
            type="url"
            required
            placeholder="https://votre-site.fr"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button disabled={loading}>{loading ? "Analyse…" : "Analyser"}</button>
        </form>
        {erreur && <p style={{ color: "var(--critique)", marginTop: "0.75rem" }}>{erreur}</p>}
      </div>

      {constats && (
        <>
          <h2>Résultats</h2>
          {constats.map((c, i) => (
            <div className="card" key={i}>
              <span className={`badge ${c.niveau === "ok" ? "ok" : c.niveau === "critique" ? "critique" : "important"}`}>
                {c.niveau === "ok" ? "✓ OK" : c.niveau === "critique" ? "🔴 Critique" : "🟠 À surveiller"}
              </span>
              <strong>{c.titre}</strong>
              <p className="muted">{c.detail}</p>
            </div>
          ))}
          <div className="card">
            <strong>Et la semaine prochaine ?</strong>
            <p className="muted">
              Un quick audit est une photo. Une régression (noindex accidentel,
              robots.txt qui bloque les IA, certificat expiré) arrive sans
              prévenir. La Garde re-vérifie chaque semaine et vous alerte
              seulement quand quelque chose casse.
            </p>
            <p style={{ marginTop: "0.6rem" }}>
              <a className="btn" href="/dashboard">
                Mettre ce site sous Garde →
              </a>
            </p>
          </div>
        </>
      )}

      <h2>Deux étages, un seul réflexe</h2>
      <div className="card">
        <strong>La Garde</strong> — abonnement par site.
        <p className="muted">
          Crawl hebdomadaire complet + vérification quotidienne des signaux
          vitaux. Diff, alertes immédiates sur les 🔴, Top 3 hebdo priorisé,
          Dossier historique. Semaine calme = « ✅ RAS », pas de bruit.
        </p>
      </div>
      <div className="card">
        <strong>Le Diagnostic</strong> — à la demande, par crédits.
        <p className="muted">
          Audit profond SEO + GEO/AEO mené par IA : pourquoi ça casse, quoi
          corriger en premier, rapport white-label à votre marque. Offert à
          l&apos;arrivée de chaque nouveau site.
        </p>
      </div>
    </main>
  );
}
