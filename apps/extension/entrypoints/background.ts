export default defineBackground(() => {
  browser.action.onClicked.addListener(() => {
    void browser.tabs.create({ url: browser.runtime.getURL("/dashboard.html") });
  });

  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.local.set({
      qtsInstallation: {
        id: crypto.randomUUID(),
        installedAt: new Date().toISOString(),
        schemaVersion: 2,
      },
    });
  });
});
