import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { ToolbarApp } from "../src/toolbar/ToolbarApp";
import "../src/styles/base.css";

export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  cssInjectionMode: "ui",
  async main(context) {
    const ui = await createShadowRootUi(context, {
      name: "qts-toolbar",
      position: "inline",
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
