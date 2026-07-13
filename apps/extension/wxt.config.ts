import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmBgr5KuBJuacjro+/oF105AQkzWyVfT9OljkLjb+QKoFmAi7iZDrfLMNo2DevsvJZsyBrW6wpPWGQpHENPgVfFVi+oKyKJsNXM0bf3C0mFhMZezxv9m77rpMPGi01mxuHCbhxMvmcQS9jzhVjEqenSGjitlC0n1TUeHUhi0m4hBHFX5Ns839ot2Ewz9Q6ZMBu5YvE6O9C+pqQnJ8MZQ51lUhg0XzbklRWcpXwZv4x6mU5hKAVXfhmXoxgCGhYqXAQiuhvUhFO3LnoDm0niZyRSPz616knROlYm2bqJi/JWDQ4Wp7pcGej7oQLyjgPTfVjOVd1DAEkswZOFIjjklECwIDAQAB",
    name: "QA Toolbar Sandbox",
    description: "Local-first QA observability and productivity tools.",
    permissions: ["storage", "scripting"],
    optional_permissions: ["notifications"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
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
