"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";

interface Finding {
  finding_id: string;
  signal: string;
  severite: "critique" | "important" | "info";
  source: string;
  pages: { url: string; poids: number }[];
  explication: string;
  correctif: string;
  statut: string;
  detecte_le: string;
}

interface Dossier {
  site: { id: string; url: string; palier: string; created_at: string };
  top3: { ras: boolean; top: { score: number; finding: Finding }[] };
  findings: Finding[];
  crawls: { id: string; type: string; statut: string; started_at: string; stats: { pagesCrawled?: number } | null }[];
  diagnostics: { id: string; profondeur: string; statut: string; offert: boolean; created_at: string }[];
}

export default function DossierPage() {
  const { id } = useParams<{ id: string }>();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setDossier(await api<Dossier>(`/sites/${id}/dossier`));
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Erreur.");
    }
  }, [id]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function action(findingId: string, verbe: "acquitter" | "corriger") {
    await api(`/findings/${findingId}/${verbe}`, { method: "POST" });
    await charger();
  }

  async function lancerCrawl() {
    setMessage("Crawl en cours…");
    try {
      await api(`/sites/${id}/crawl`, { method: "POST", body: JSON.stringify({ type: "hebdo" }) });
      setMessage("Crawl terminé.");
      await charger();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    }
  }

  async function lancerDiagnostic() {
    setMessage(null);
    try {
      await api(`/sites/${id}/diagnostic`, { method: "POST", body: JSON.stringify({ profondeur: "full" }) });
      setMessage("Diagnostic lancé — vous serez prévenu par email.");
      await charger();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    }
  }

  if (erreur) {
    return (
      <main>
        <p style={{ color: "var(--critique)" }}>{erreur}</p>
      </main>
    );
  }
  if (!dossier) {
    return (
      <main>
        <p className="muted">Chargement du Dossier…</p>
      </main>
    );
  }

  const ouverts = dossier.findings.filter((f) => f.statut === "ouvert");

  return (
    <main>
      <h1>{dossier.site.url}</h1>
      <p className="muted">
        Le Dossier — sous Garde depuis le{" "}
        {new Date(dossier.site.created_at).toLocaleDateString("fr-FR")} · palier{" "}
        {dossier.site.palier}
      </p>
      <p className="row" style={{ marginTop: "0.75rem" }}>
        <button onClick={lancerCrawl}>Lancer un crawl</button>
        <button className="secondary" onClick={lancerDiagnostic}>
          Lancer un Diagnostic (1 crédit)
        </button>
      </p>
      {message && <p className="muted">{message}</p>}

      <h2>Top 3 de la semaine</h2>
      {dossier.top3.ras ? (
        <div className="card">
          <span className="badge ok">✅ RAS</span> Rien à signaler — la Garde
          continue de veiller.
        </div>
      ) : (
        dossier.top3.top.map((s, i) => (
          <div className="card" key={s.finding.finding_id}>
            <strong>
              n°{i + 1} · <span className={`badge ${s.finding.severite}`}>{s.finding.severite}</span>
              {s.finding.explication}
            </strong>
            <p className="muted" style={{ marginTop: "0.4rem" }}>{s.finding.correctif}</p>
            <p className="row" style={{ marginTop: "0.6rem" }}>
              <button className="secondary" onClick={() => action(s.finding.finding_id, "corriger")}>
                Marquer corrigé
              </button>
              <button className="secondary" onClick={() => action(s.finding.finding_id, "acquitter")}>
                C&apos;est voulu (acquitter)
              </button>
            </p>
          </div>
        ))
      )}

      <h2>Alertes et constats ouverts ({ouverts.length})</h2>
      {ouverts.length === 0 && <p className="muted">Aucun constat ouvert.</p>}
      {ouverts.map((f) => (
        <div className="card" key={f.finding_id}>
          <span className={`badge ${f.severite}`}>{f.severite}</span>
          <span className="badge info">{f.source}</span>
          <strong>{f.explication}</strong>
          <p className="muted">{f.correctif}</p>
          {f.pages.length > 0 && (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {f.pages.slice(0, 5).map((p) => p.url).join(" · ")}
              {f.pages.length > 5 ? ` · +${f.pages.length - 5} pages` : ""}
            </p>
          )}
          <p className="row" style={{ marginTop: "0.6rem" }}>
            <button className="secondary" onClick={() => action(f.finding_id, "corriger")}>
              Corrigé
            </button>
            <button className="secondary" onClick={() => action(f.finding_id, "acquitter")}>
              Acquitter
            </button>
          </p>
        </div>
      ))}

      <h2>Diagnostics</h2>
      {dossier.diagnostics.length === 0 && <p className="muted">Aucun Diagnostic pour l&apos;instant.</p>}
      {dossier.diagnostics.map((d) => (
        <div className="card" key={d.id}>
          <strong>
            {d.profondeur === "quick" ? "Quick" : "Complet"}
            {d.offert ? " (offert)" : ""}
          </strong>{" "}
          — {d.statut} ·{" "}
          <span className="muted">{new Date(d.created_at).toLocaleString("fr-FR")}</span>
        </div>
      ))}

      <h2>Historique des crawls</h2>
      {dossier.crawls.map((c) => (
        <div className="card" key={c.id}>
          <strong>{c.type}</strong> — {c.statut} ·{" "}
          <span className="muted">
            {new Date(c.started_at).toLocaleString("fr-FR")}
            {c.stats?.pagesCrawled !== undefined ? ` · ${c.stats.pagesCrawled} pages` : ""}
          </span>
        </div>
      ))}
    </main>
  );
}
