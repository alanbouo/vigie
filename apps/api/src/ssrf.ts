import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Anti-SSRF (§9) : validation stricte des URLs soumises — pas d'IP privées,
 * pas de localhost, pas de schémas exotiques. Résolution DNS incluse pour
 * bloquer les domaines pointant vers le réseau interne.
 */

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
];

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return PRIVATE_V4.some((re) => re.test(ip));
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
      return true;
    }
    // IPv4-mappée : ::ffff:192.168.0.1
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
  }
  return false;
}

export class SsrfError extends Error {}

/** Valide une URL de site soumise par un utilisateur. Renvoie l'URL normalisée. */
export async function validateSiteUrl(input: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SsrfError("URL invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("Seuls les schémas http et https sont acceptés.");
  }
  if (url.username || url.password) {
    throw new SsrfError("URL avec identifiants refusée.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new SsrfError("Port non standard refusé.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".")
  ) {
    throw new SsrfError("Hôte local ou interne refusé.");
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new SsrfError("Adresse IP privée refusée.");
    throw new SsrfError("Soumettre un nom de domaine, pas une adresse IP.");
  }
  // Résolution DNS : le domaine ne doit pas pointer vers le réseau interne.
  try {
    const results = await lookup(hostname, { all: true });
    if (results.length === 0) throw new SsrfError("Domaine introuvable.");
    for (const r of results) {
      if (isPrivateIp(r.address)) {
        throw new SsrfError("Ce domaine pointe vers une adresse interne.");
      }
    }
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    throw new SsrfError("Domaine introuvable ou non résolvable.");
  }
  return url.toString();
}
