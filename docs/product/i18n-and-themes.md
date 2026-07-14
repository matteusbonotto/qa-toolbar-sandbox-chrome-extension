# Internationalization and themes

The product supports `pt-BR`, `en` and `es`. The selected locale is stored as `qtsLocale`, applied to the landing page, privacy policy, onboarding, options, toolbar and user surfaces, and reflected in `document.documentElement.lang`. The shared domain package provides catalog fallback, interpolation, plural selection and locale-aware currency, date/time and duration formatting. Visible text, ARIA labels, titles and placeholders use the shared localization layer; the legal policy uses explicit reviewed copies for every locale.

Catalog parity is enforced by domain tests. When a new visible phrase is introduced, add the same key or phrase in all three locales and extend the related UI test. Language choices always include their written name and never rely on flags alone.

Extension themes are `light`, `dark` and `system`, with persisted accent and semantic environment colors. Theme tokens are scoped to extension roots and Shadow DOM, so the host page is not restyled. Status and environment indicators combine text/icon/pattern with color and expose accessible labels. Verify theme changes in popup/options/toolbar, system changes, contrast, 200% zoom and `prefers-reduced-motion` before release.

