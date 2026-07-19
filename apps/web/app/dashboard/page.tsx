"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getApiKey, setApiKey } from "../../lib/api";

interface SiteRow {
  id: string;
  url: string;
  palier: string;
  critiques_ouverts: string;
  dernier_crawl: string | null;
}

export default function Dashboard() {
  const [key, setKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nouveauSite, setNouveauSite] = useState("");
  const [credits, setCredits] = useState<number | null>(null);

  async function charger() {
    try {
      const [s, c] = await Promise.all([
        api<{ sites: SiteRow[] }>("/sites"),
        api<{ solde: number }>("/credits"),
      ]);
      setSites(s.sites);
      setCredits(c.solde);
      setConnected(true);
      setErreur(null);
    } catch (err) {
      setConnected(false);
      setErreur(err instanceof Error ? err.message : "Erreur.");
    }
  }

  useEffect(() => {
    if (getApiKey()) void charger();
  }, []);

  async function connecter(e: React.FormEvent) {
    e.preventDefault();
    setApiKey(key.trim());
    await charger();
  }

  async function ajouterSite(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/sites", { method: "POST", body: JSON.stringify({ url: nouveauSite }) });
      setNouveauSite("");
      await charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Erreur.");
    }
  }

  if (!connected) {
    return (
      <main>
        <h1>Dashboard agence</h1>
        <p className="muted">Collez votre clé API pour accéder à vos Dossiers.</p>
        <div className="card">
          <form onSubmit={connecter} className="row">
            <input
              placeholder="Clé API"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button>Se connecter</button>
          </form>
          {erreur && <p style={{ color: "var(--critique)", marginTop: "0.6rem" }}>{erreur}</p>}
          <p className="muted" style={{ marginTop: "0.6rem" }}>
            Pas encore de compte ? <code>POST /agencies</code> avec nom + email —
            la clé est renvoyée une seule fois.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Vos sites sous Garde</h1>
      <p className="muted">
        {sites.length} site{sites.length > 1 ? "s" : ""} surveillé
        {sites.length > 1 ? "s" : ""} · {credits ?? 0} crédit
        {(credits ?? 0) > 1 ? "s" : ""} Diagnostic
      </p>

      <div className="card">
        <form onSubmit={ajouterSite} className="row">
          <input
            type="url"
            required
            placeholder="https://site-client.fr — le Diagnostic d'onboarding est offert"
            value={nouveauSite}
            onChange={(e) => setNouveauSite(e.target.value)}
          />
          <button>Mettre sous Garde</button>
        </form>
      </div>
      {erreur && <p style={{ color: "var(--critique)" }}>{erreur}</p>}

      {sites.map((s) => (
        <Link href={`/sites/${s.id}`} key={s.id}>
          <div className="card row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{s.url}</strong>
              <p className="muted">
                Palier {s.palier} · dernier crawl :{" "}
                {s.dernier_crawl ? new Date(s.dernier_crawl).toLocaleString("fr-FR") : "—"}
              </p>
            </div>
            {Number(s.critiques_ouverts) > 0 ? (
              <span className="badge critique">
                🔴 {s.critiques_ouverts} alerte{Number(s.critiques_ouverts) > 1 ? "s" : ""}
              </span>
            ) : (
              <span className="badge ok">✅ RAS</span>
            )}
          </div>
        </Link>
      ))}
    </main>
  );
}
