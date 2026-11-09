/**
 * Content-Security-Policy builder.
 *
 * script-src uses a per-request nonce plus 'strict-dynamic' (no 'unsafe-inline',
 * no 'unsafe-eval'): the nonce is generated once per request in proxy.ts,
 * forwarded as the 'x-nonce' request header, and Next.js itself reads the
 * nonce back out of this same Content-Security-Policy response header to
 * attach it to every script tag it renders (framework runtime, page bundles,
 * the RSC/hydration payload) -- see
 * https://nextjs.org/docs/app/guides/content-security-policy. No manual
 * wiring is needed in individual pages for that to work; only a route that
 * hand-builds raw HTML (buildAutoSubmitFormResponse in
 * server/flow-initiation.ts) has to attach the nonce itself.
 *
 * style-src is split into style-src-elem (nonce'd, covers <style> tags and
 * stylesheet links) and style-src-attr (kept at 'unsafe-inline'): CSP has no
 * nonce mechanism for the style="" HTML attribute, and this app's Radix UI
 * components (popovers, tooltips, dropdowns) position themselves by writing
 * directly to element.style at runtime. There is no fixed, hashable set of
 * values for that -- it's computed per render from viewport/anchor position --
 * so 'unsafe-hashes' is not an option either. Scoping the loosened grant to
 * style-src-attr only (not blanket style-src) keeps the far more dangerous
 * surface, <script>/<style> *elements*, fully locked to the nonce.
 */
const STATIC_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "connect-src": ["'self'"],
  "style-src-attr": ["'unsafe-inline'"],
  "font-src": ["'self'"],
  "img-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  // Same-origin form posts only. The one stock Login V2 code path that posts
  // a form to a third-party origin -- buildAutoSubmitFormResponse's SAML POST
  // binding, server/flow-initiation.ts -- is unreached in this deployment
  // (the pilot has no SAML/external IdP configured, see causality-auth
  // README "Public surface"). If that's ever turned on, form-action needs
  // the specific IdP origin added alongside 'self'.
  "form-action": ["'self'"],
};

export interface CSPOptions {
  serviceUrl?: string;
  iframeOrigins?: string[] | null;
  nonce?: string;
}

export function buildCSP(options: CSPOptions = {}): string {
  const directives: Record<string, string[]> = Object.fromEntries(
    Object.entries(STATIC_DIRECTIVES).map(([key, values]) => [key, [...values]]),
  );

  let scriptSrc: string[];
  const styleSrcElem = ["'self'"];
  if (options.nonce) {
    // 'https:' is a no-op wherever 'strict-dynamic' is understood (every
    // evergreen browser) and only matters as a fallback for the very rare
    // CSP2-only client that has nonces but not strict-dynamic -- same
    // belt-and-suspenders Next.js's own strict-CSP example ships.
    scriptSrc = ["'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'", "https:"];
    styleSrcElem.push(`'nonce-${options.nonce}'`);
  } else {
    // No nonce available. proxy.ts always generates one for every page
    // response; this branch only guards against some future caller that
    // forgets to pass one, and fails closed (blocks scripts) rather than
    // silently falling back to 'unsafe-inline'/'unsafe-eval'.
    scriptSrc = ["'none'"];
    styleSrcElem.push("'unsafe-inline'");
  }
  directives["script-src"] = scriptSrc;
  directives["style-src-elem"] = styleSrcElem;

  if (options.serviceUrl) {
    directives["img-src"] = [...directives["img-src"], options.serviceUrl];
    directives["font-src"] = [...directives["font-src"], options.serviceUrl];
  }

  if (options.iframeOrigins && options.iframeOrigins.length > 0) {
    directives["frame-ancestors"] = [...options.iframeOrigins];
  }

  return serializeCSP(directives);
}

function serializeCSP(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([key, values]) => [key, ...values].join(" "))
    .join("; ");
}
