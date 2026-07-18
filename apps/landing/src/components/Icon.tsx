// Bootstrap Icons (MIT), imported per-icon as raw SVG so only the ones actually used end up in
// the bundle. `fill="currentColor"` in the source SVGs means these inherit text color via CSS.
import iconAspectRatio from "bootstrap-icons/icons/aspect-ratio.svg?raw";
import iconBraces from "bootstrap-icons/icons/braces.svg?raw";
import iconCamera from "bootstrap-icons/icons/camera.svg?raw";
import iconCheckSquare from "bootstrap-icons/icons/check-square.svg?raw";
import iconCheck2Circle from "bootstrap-icons/icons/check2-circle.svg?raw";
import iconChevronDown from "bootstrap-icons/icons/chevron-down.svg?raw";
import iconCodeSlash from "bootstrap-icons/icons/code-slash.svg?raw";
import iconCreditCard from "bootstrap-icons/icons/credit-card.svg?raw";
import iconExclamationTriangle from "bootstrap-icons/icons/exclamation-triangle.svg?raw";
import iconFonts from "bootstrap-icons/icons/fonts.svg?raw";
import iconKey from "bootstrap-icons/icons/key.svg?raw";
import iconKeyboard from "bootstrap-icons/icons/keyboard.svg?raw";
import iconLightningCharge from "bootstrap-icons/icons/lightning-charge.svg?raw";
import iconLink45deg from "bootstrap-icons/icons/link-45deg.svg?raw";
import iconMouse2 from "bootstrap-icons/icons/mouse2.svg?raw";
import iconPauseCircle from "bootstrap-icons/icons/pause-circle.svg?raw";
import iconPuzzle from "bootstrap-icons/icons/puzzle.svg?raw";
import iconRecordCircle from "bootstrap-icons/icons/record-circle.svg?raw";
import iconSquare from "bootstrap-icons/icons/square.svg?raw";
import iconStars from "bootstrap-icons/icons/stars.svg?raw";

const ICONS = {
  aspectRatio: iconAspectRatio,
  braces: iconBraces,
  camera: iconCamera,
  checkSquare: iconCheckSquare,
  check2Circle: iconCheck2Circle,
  chevronDown: iconChevronDown,
  codeSlash: iconCodeSlash,
  creditCard: iconCreditCard,
  exclamationTriangle: iconExclamationTriangle,
  fonts: iconFonts,
  key: iconKey,
  keyboard: iconKeyboard,
  lightningCharge: iconLightningCharge,
  link45deg: iconLink45deg,
  mouse2: iconMouse2,
  pauseCircle: iconPauseCircle,
  puzzle: iconPuzzle,
  recordCircle: iconRecordCircle,
  square: iconSquare,
  stars: iconStars,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
