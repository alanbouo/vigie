import * as tls from "node:tls";

export interface SslInfo {
  validTo: string | null;
  daysRemaining: number | null;
  error: string | null;
}

/** Lit la date d'expiration du certificat TLS du site. */
export function checkSsl(hostname: string, timeoutMs = 10_000): Promise<SslInfo> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname,
        // On veut lire le certificat même s'il est expiré ou invalide.
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          resolve({ validTo: null, daysRemaining: null, error: "certificat illisible" });
          return;
        }
        const validTo = new Date(cert.valid_to);
        const daysRemaining = Math.floor(
          (validTo.getTime() - Date.now()) / (24 * 3600 * 1000)
        );
        resolve({ validTo: validTo.toISOString(), daysRemaining, error: null });
      }
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({ validTo: null, daysRemaining: null, error: "timeout TLS" });
    });
    socket.on("error", (err) => {
      resolve({ validTo: null, daysRemaining: null, error: err.message });
    });
  });
}
