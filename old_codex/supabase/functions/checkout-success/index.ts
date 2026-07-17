const landingUrl = "https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/?checkout=success#planos";

Deno.serve(() => Response.redirect(landingUrl, 303));
