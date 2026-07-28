// Pre-renders the ecosystem flowchart (the same one documented in docs/ecosystem-audit.md's
// "Visão geral" section) to a static SVG at authoring time, instead of shipping the ~900KB gzipped
// mermaid runtime to every visitor of the landing page's trust center. Re-run this whenever the
// diagram source below (or the theme colors it's matched against) changes:
//
//   node scripts/render-ecosystem-diagram.mjs
//
// Uses the same Playwright/Chromium already installed for scripts/test-gif-encoder.mjs and the
// extension smoke tests - no new runtime dependency for the app itself.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT_PATH = resolve(ROOT, "apps/landing/src/assets/ecosystem-diagram.svg");
const MERMAID_BUNDLE = resolve(ROOT, "node_modules/mermaid/dist/mermaid.min.js");

// Keep byte-for-byte identical to docs/ecosystem-audit.md's mermaid block - this script has no
// way to enforce that automatically, so if you change one, change the other.
const DIAGRAM_SOURCE = `flowchart LR
  subgraph Client["Navegador do usuário"]
    LP["Landing Page\\napps/landing\\nGitHub Pages"]
    ADMIN["Admin (founder-only)\\napps/admin\\nGitHub Pages /admin"]
    EXT["Extensão Chrome\\napps/extension\\nManifest V3"]
  end

  subgraph Supabase["Supabase (projeto único)"]
    DB[("Postgres\\n+ RLS deny-by-default")]
    AUTH["Auth\\n(e-mail+senha, OTP admin)"]
    EDGE["Edge Functions (Deno)\\ncheckout-create-session, stripe-webhook,\\nvoucher-redeem/preview, legal-registration,\\nreferral-track, rewards-spin, keep-alive,\\naccess-status, auth-sign-in/refresh/recover,\\nadmin-email-otp, account-delete"]
  end

  STRIPE["Stripe\\ncheckout + webhooks"]
  CWS["Chrome Web Store\\npágina pública + Publish API"]
  RESEND["Resend\\ne-mail transacional"]

  LP -- "signIn/signUp, loadPriceCatalog,\\nstartCheckout, previewVoucher" --> EDGE
  LP -- leitura pública (planos, preços,\\nstore_listing_status) --> DB
  ADMIN -- "CRUD via PostgREST + RPCs\\n(is_founder(), MFA)" --> DB
  ADMIN -- deploy/redeploy --> EDGE
  EXT -- "access-status (cache ~30s),\\nauth-sign-in/refresh,\\naccount-delete" --> EDGE
  EXT -. "sem chamada direta ao Postgres" .-> DB
  EDGE --> DB
  EDGE --> STRIPE
  EDGE --> RESEND
  STRIPE -- "invoice.*, checkout.session.*" --> EDGE
  LP -- "instalar" --> CWS
  ADMIN -- "publish-chrome-webstore.mjs" --> CWS`;

// Matches apps/landing/src/styles/tokens.css.
const THEME_VARIABLES = {
  darkMode: true,
  background: "transparent",
  fontFamily: "Inter, \"Segoe UI\", system-ui, -apple-system, sans-serif",
  primaryColor: "#171a29",
  primaryTextColor: "#f4f5f9",
  primaryBorderColor: "#7c5cff",
  secondaryColor: "#12141f",
  secondaryBorderColor: "rgba(255, 255, 255, 0.16)",
  tertiaryColor: "#0d0f18",
  tertiaryBorderColor: "rgba(255, 255, 255, 0.16)",
  lineColor: "#9d84ff",
  textColor: "#f4f5f9",
  mainBkg: "#171a29",
  nodeBorder: "#7c5cff",
  clusterBkg: "rgba(124, 92, 255, 0.08)",
  clusterBorder: "rgba(124, 92, 255, 0.35)",
  edgeLabelBackground: "#0d0f18",
  labelTextColor: "#f4f5f9",
};

if (!existsSync(MERMAID_BUNDLE)) {
  console.error("mermaid isn't installed. Run: npm install --workspace apps/landing --no-save mermaid");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ path: MERMAID_BUNDLE });

const svg = await page.evaluate(
  async ({ source, theme }) => {
    // eslint-disable-next-line no-undef -- injected by the mermaid.min.js script tag
    window.mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: theme, securityLevel: "strict" });
    // eslint-disable-next-line no-undef
    const result = await window.mermaid.render("qts-ecosystem-diagram", source);
    return result.svg;
  },
  { source: DIAGRAM_SOURCE, theme: THEME_VARIABLES },
);

await browser.close();

// Strip the width/height/max-width inline styling mermaid bakes in so the SVG scales with its
// container via CSS instead of a fixed pixel size.
const responsiveSvg = svg.replace(/<svg([^>]*)\swidth="[\d.]+"([^>]*)\sheight="[\d.]+"/, "<svg$1$2");

writeFileSync(OUTPUT_PATH, responsiveSvg, "utf8");
console.log(`Wrote ${responsiveSvg.length} bytes to ${OUTPUT_PATH}`);
