import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "QA Toolbar Sandbox",
    description: "Local-first QA observability and productivity tools.",
    permissions: ["storage", "scripting", "activeTab"],
    optional_permissions: ["notifications"],
    optional_host_permissions: ["http://*/*", "https://*/*", "https://api.convertio.co/*"],
    externally_connectable: {
      matches: ["https://matteusbonotto.github.io/*"],
    },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'; frame-src http: https:" },
    web_accessible_resources: [{
      resources: ["content-scripts/content.css"],
      matches: ["http://*/*", "https://*/*"],
    }],
    action: {
      default_title: "QA Toolbar Sandbox",
      default_icon: {
        16: "icons/qa-sandbox-icon-16.png",
        32: "icons/qa-sandbox-icon-32.png",
        48: "icons/qa-sandbox-icon-48.png",
        128: "icons/qa-sandbox-icon-128.png",
      },
    },
    icons: {
      16: "icons/qa-sandbox-icon-16.png",
      32: "icons/qa-sandbox-icon-32.png",
      48: "icons/qa-sandbox-icon-48.png",
      128: "icons/qa-sandbox-icon-128.png",
    },
  },
});
