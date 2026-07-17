import { describe, expect, it } from "vitest";
import { formatCurrency, translate, translateVisibleText, translationCatalog } from "./i18n";
describe("i18n catalogs", () => {
  it("keeps all locale keys in parity and supports interpolation/plural", () => {
    const keys = Object.keys(translationCatalog["pt-BR"]).sort();
    expect(Object.keys(translationCatalog.en).sort()).toEqual(keys); expect(Object.keys(translationCatalog.es).sort()).toEqual(keys);
    expect(translate("en", "errors.items", { count: 2 })).toBe("2 errors");
    expect(formatCurrency("pt-BR", 29.9)).toContain("29,90");
  });
  it("localizes visible literals with a PT-BR fallback", () => {
    expect(translateVisibleText("en", "  Criar conta  ")).toBe("  Create account  ");
    expect(translateVisibleText("es", "Exportação segura")).toBe("Exportación segura");
    expect(translateVisibleText("pt-BR", "Criar conta")).toBe("Criar conta");
  });
});
