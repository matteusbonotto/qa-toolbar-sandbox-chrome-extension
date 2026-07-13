const landingUrl = "https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/?checkout=cancel#planos";

Deno.serve(() => Response.redirect(landingUrl, 303));
