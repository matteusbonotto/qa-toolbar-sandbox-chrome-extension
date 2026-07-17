function hashHue(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function autoInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

interface EntityBadgeProps {
  name: string;
  abbreviation?: string | undefined;
  showLabel?: boolean | undefined;
  size?: number | undefined;
  maxChars?: number | undefined;
}

/**
 * White-label avatar: an entity with no logo/abbreviation still gets a
 * colored initials badge (never a blank space), matching the same rule
 * used by the real extension's window.QTS_AVATAR helper.
 */
export function EntityBadge({ name, abbreviation, showLabel = true, size = 20, maxChars = 16 }: EntityBadgeProps) {
  const label = (abbreviation || autoInitials(name)).slice(0, 4);
  const hue = hashHue(name || label);
  const truncatedName = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;

  return (
    <span className="qts-entity-badge" title={name}>
      <span
        className="qts-badge-avatar"
        style={{ width: size, height: size, background: `hsl(${hue}, 65%, 38%)`, fontSize: Math.max(8, size * 0.42) }}
      >
        {label}
      </span>
      {showLabel ? <span className="qts-badge-name">{truncatedName}</span> : null}
    </span>
  );
}
