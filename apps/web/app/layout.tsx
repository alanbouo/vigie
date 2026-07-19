import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vigie — le système de santé de votre visibilité",
  description:
    "Surveillance continue de votre référencement, sur Google et dans les réponses des IA. Alertes quand ça casse, diagnostic profond quand ça compte.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <nav>
          <Link className="brand" href="/">
            🔭 Vigie
          </Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/#quick-audit">Quick audit gratuit</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
