import { describe, expect, it } from "vitest";
import { isPrivateIp, validateSiteUrl, SsrfError } from "../src/ssrf.js";

describe("anti-SSRF (§9)", () => {
  it("détecte les IP privées v4", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("détecte les IP privées v6 (dont IPv4-mappées)", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fd00::1")).toBe(true);
    expect(isPrivateIp("::ffff:192.168.0.1")).toBe(true);
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });

  it("refuse les schémas exotiques", async () => {
    await expect(validateSiteUrl("file:///etc/passwd")).rejects.toThrow(SsrfError);
    await expect(validateSiteUrl("ftp://ex.com")).rejects.toThrow(SsrfError);
    await expect(validateSiteUrl("gopher://ex.com")).rejects.toThrow(SsrfError);
  });

  it("refuse localhost et les hôtes internes", async () => {
    await expect(validateSiteUrl("http://localhost")).rejects.toThrow(SsrfError);
    await expect(validateSiteUrl("http://foo.localhost")).rejects.toThrow(SsrfError);
    await expect(validateSiteUrl("http://intranet")).rejects.toThrow(SsrfError);
    await expect(validateSiteUrl("http://serveur.internal")).rejects.toThrow(SsrfError);
  });

  it("refuse les IP littérales, même publiques", async () => {
    await expect(validateSiteUrl("http://127.0.0.1/admin")).rejects.toThrow(SsrfError);
    await expect(validateSiteUrl("http://8.8.8.8")).rejects.toThrow(SsrfError);
  });

  it("refuse identifiants et ports non standards", async () => {
    await expect(validateSiteUrl("http://user:pass@ex.com")).rejects.toThrow(SsrfError);
    await expect(validateSiteUrl("http://ex.com:8080")).rejects.toThrow(SsrfError);
  });
});
