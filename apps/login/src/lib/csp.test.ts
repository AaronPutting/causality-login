import { describe, expect, test } from "vitest";
import { buildCSP } from "./csp";

describe("buildCSP", () => {
  test("returns all base directives with safe defaults (no nonce)", () => {
    const csp = buildCSP();

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("style-src-elem 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });

  test("uses the nonce for script-src and style-src-elem, with strict-dynamic", () => {
    const csp = buildCSP({ nonce: "abc123" });

    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic' https:");
    expect(csp).toContain("style-src-elem 'self' 'nonce-abc123'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-inline' 'unsafe-eval'");
  });

  test("adds serviceUrl to img-src and font-src", () => {
    const csp = buildCSP({ serviceUrl: "https://my-instance.zitadel.cloud", nonce: "n1" });

    expect(csp).toContain("img-src 'self' https://my-instance.zitadel.cloud");
    expect(csp).toContain("font-src 'self' https://my-instance.zitadel.cloud");
  });

  test("keeps frame-ancestors as 'none' when iframeOrigins is empty", () => {
    const csp = buildCSP({ iframeOrigins: [], nonce: "n1" });

    expect(csp).toContain("frame-ancestors 'none'");
  });

  test("overrides frame-ancestors when iframeOrigins are provided", () => {
    const csp = buildCSP({
      iframeOrigins: ["https://app.example.com", "https://other.example.com"],
      nonce: "n1",
    });

    expect(csp).toContain("frame-ancestors https://app.example.com https://other.example.com");
    expect(csp).not.toContain("frame-ancestors 'none'");
  });

  test("combines serviceUrl and iframeOrigins", () => {
    const csp = buildCSP({
      serviceUrl: "https://zitadel.mycompany.com",
      iframeOrigins: ["https://portal.mycompany.com"],
      nonce: "n1",
    });

    expect(csp).toContain("img-src 'self' https://zitadel.mycompany.com");
    expect(csp).toContain("font-src 'self' https://zitadel.mycompany.com");
    expect(csp).toContain("frame-ancestors https://portal.mycompany.com");
    expect(csp).not.toContain("frame-ancestors 'none'");
  });

  test("base directives are preserved when options are set", () => {
    const csp = buildCSP({
      serviceUrl: "https://example.com",
      iframeOrigins: ["https://embed.example.com"],
      nonce: "n1",
    });

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
