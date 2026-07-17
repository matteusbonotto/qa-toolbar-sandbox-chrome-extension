import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrivacyPolicy } from "./PrivacyPolicy";

describe("privacy policy", () => {
  it("publishes the core Chrome Web Store and LGPD disclosures", () => {
    const html = renderToStaticMarkup(<PrivacyPolicy />);
    expect(html).toContain("Política de Privacidade");
    expect(html).toContain("Dados mantidos localmente");
    expect(html).toContain("Dados de pagamento");
    expect(html).toContain("Limited Use");
    expect(html).toContain("Seus direitos");
    expect(html).toContain("Não vendemos dados");
    expect(html).toContain("2026-07-14");
    expect(html).toContain("Português (Brasil)");
    expect(html).toContain("English");
    expect(html).toContain("Español");
  });
});
