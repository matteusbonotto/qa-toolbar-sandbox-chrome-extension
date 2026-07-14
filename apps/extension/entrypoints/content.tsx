import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { ToolbarApp } from "../src/toolbar/ToolbarApp";
import { urlMatchesAny } from "../src/services/workspace";
import "../src/styles/base.css";

export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  cssInjectionMode: "ui",
  async main(context) {
    const { qtsSetup } = await browser.storage.local.get("qtsSetup");
    const configured = qtsSetup as { urlPatterns?: string[]; domains?: string[] } | undefined;
    const patterns = configured?.urlPatterns ?? configured?.domains ?? ["localhost", "127.0.0.1"];
    if (!urlMatchesAny(window.location.href, patterns)) return;
    const ui = await createShadowRootUi(context, {
      name: "qts-toolbar",
      position: "overlay",
      alignment: "top-left",
      zIndex: 2147483000,
      anchor: "body",
      onMount(container) {
        const root = createRoot(container);
        root.render(<ToolbarApp />);
        return root;
      },
      onRemove(root?: Root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
