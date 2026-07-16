import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { ToolbarApp } from "../src/toolbar/ToolbarApp";
import { urlMatchesAny } from "../src/services/workspace";
import { createAuthApi } from "../src/services/runtimeConfig";
import { authorizeExtensionSurface } from "../src/services/accessGate";
import "../src/styles/base.css";

export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  cssInjectionMode: "ui",
  async main(context) {
    // Authentication is enforced before reading workspace data or mounting any UI.
    // Options-page routing alone is not an authorization boundary.
    const session = await authorizeExtensionSurface(createAuthApi());
    if (!session) return;
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
    const removeOnSignOut = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      // Only a real qtsAuthSession removal is a sign-out. Optional chaining made
      // every unrelated storage update (entitlements, preferences, evidence)
      // look like a removal and caused the toolbar to disappear after a click.
      if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, "qtsAuthSession") && changes.qtsAuthSession?.newValue === undefined) ui.remove();
    };
    browser.storage.onChanged.addListener(removeOnSignOut);
    context.onInvalidated(() => browser.storage.onChanged.removeListener(removeOnSignOut));
  },
});
