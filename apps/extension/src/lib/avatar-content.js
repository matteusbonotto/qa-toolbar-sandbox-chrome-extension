/**
 * Shared white-label badge renderer for Client/Project/Product entities.
 * Classic script (same reasoning as storage-content.js / i18n-content.js):
 * dynamically registered content scripts can't use ES module imports, so
 * this exposes window.QTS_AVATAR instead of being a real module.
 *
 * An entity is white-labeled by priority: a logo image if `logoUrl` is set,
 * otherwise a colored initials badge built from `abbreviation` (user-picked,
 * up to 4 chars) or auto-derived from the first letters of `name` — so a
 * brand-new client with no logo yet is never a blank space.
 */
(function initQtsAvatar() {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function hashHue(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  }

  function autoInitials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  /**
   * @param {{ name?: string, logoUrl?: string, abbreviation?: string }} entity
   * @param {{ size?: number }} [options]
   * @returns {string} HTML for a single badge element.
   */
  function buildBadgeHtml(entity, options) {
    const size = options?.size || 20;
    const name = entity?.name || "";
    if (entity?.logoUrl) {
      return `<img class="qts-badge-avatar" src="${escapeHtml(entity.logoUrl)}" alt="${escapeHtml(name)}" title="${escapeHtml(name)}" style="width:${size}px;height:${size}px" />`;
    }
    const label = (entity?.abbreviation || autoInitials(name)).slice(0, 4);
    const hue = hashHue(name || label);
    return `<span class="qts-badge-avatar qts-badge-initials" title="${escapeHtml(name)}" style="width:${size}px;height:${size}px;background:hsl(${hue},65%,38%);font-size:${Math.max(8, size * 0.42)}px">${escapeHtml(label)}</span>`;
  }

  /**
   * Full badge: avatar plus the entity name, shown only when `showLabel`
   * is not explicitly false (keeps existing text-only workspaces looking
   * the same until someone opts into icon-only mode).
   */
  function buildEntityHtml(entity, options) {
    const avatar = buildBadgeHtml(entity, options);
    if (entity && entity.showLabel === false) return avatar;
    const maxChars = options?.maxChars || 18;
    const name = String(entity?.name || "");
    const truncated = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
    return `${avatar}<span class="qts-badge-name">${escapeHtml(truncated)}</span>`;
  }

  window.QTS_AVATAR = { buildBadgeHtml, buildEntityHtml, autoInitials };
})();
