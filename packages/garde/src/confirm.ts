import { randomUUID } from "node:crypto";
import { getSignal, type Finding } from "@vigie/core";
import type { ChangeEvent } from "./types.js";

/**
 * Règle anti-bruit n°2 (§3.5) : confirmation sur 2 crawls pour tout sauf les
 * 🔴 francs (noindex, down, SSL, robots bloquant — marqués
 * confirmationRequise: false dans la taxonomie).
 *
 * Un événement vu pour la première fois est enregistré non confirmé ; s'il est
 * revu au crawl suivant (même causeKey), il devient confirmé et déclenche.
 */

export interface PendingEvent {
  causeKey: string;
  signal: string;
  /** Date de première détection. */
  detecteLe: string;
}

export interface ReconciliationResult {
  /** Événements confirmés → à transformer en findings / alertes. */
  confirmes: ChangeEvent[];
  /** Événements vus pour la première fois, en attente de confirmation. */
  enAttente: ChangeEvent[];
  /** causeKeys précédemment en attente, non revus : bruit ponctuel, on oublie. */
  disparus: string[];
}

export function reconcile(
  pendingBefore: PendingEvent[],
  events: ChangeEvent[]
): ReconciliationResult {
  const pendingKeys = new Set(pendingBefore.map((p) => p.causeKey));
  const seenKeys = new Set(events.map((e) => e.causeKey));

  const confirmes: ChangeEvent[] = [];
  const enAttente: ChangeEvent[] = [];

  for (const event of events) {
    const def = getSignal(event.signal);
    if (!def.confirmationRequise || event.severite === "info") {
      // 🔴 franc ou info : pas de purgatoire.
      confirmes.push(event);
    } else if (pendingKeys.has(event.causeKey)) {
      confirmes.push(event);
    } else {
      enAttente.push(event);
    }
  }

  const disparus = pendingBefore
    .filter((p) => !seenKeys.has(p.causeKey))
    .map((p) => p.causeKey);

  return { confirmes, enAttente, disparus };
}

/** Transforme un événement de changement en finding unifié (§5). */
export function eventToFinding(
  event: ChangeEvent,
  siteId: string,
  opts: { confirme: boolean; detecteLe?: Date }
): Finding {
  const def = getSignal(event.signal);
  return {
    finding_id: randomUUID(),
    site_id: siteId,
    source: "garde",
    pilier: def.pilier,
    signal: event.signal,
    severite: event.severite,
    pages: event.pages,
    explication: event.explication,
    correctif: event.correctif,
    effort: def.effortDefaut,
    detecte_le: opts.detecteLe ?? new Date(),
    confirme: opts.confirme,
    statut: "ouvert",
  };
}
