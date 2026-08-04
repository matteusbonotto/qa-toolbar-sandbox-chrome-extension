import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./Icon";

interface ToastProps {
  message: string;
  tone: "error" | "success";
  onClose: () => void;
  closeLabel: string;
  action?: { label: string; onClick: () => void };
}

// Top-center, auto-dismissing, manually closeable - the shape every mainstream toast library
// (react-hot-toast, sonner, etc.) settles on, so this stays instantly familiar instead of
// inventing a bespoke pattern just for this one message slot. Fixed `width` (not just max-width)
// on the card matters: without it, an auto-sized flex row lets a `flex:1; min-width:0` text span
// collapse to a sliver during layout while the non-shrinking action/close buttons keep their full
// width, which is what turned the message into a single narrow, many-line column.
export function Toast({ message, tone, onClose, closeLabel, action }: ToastProps) {
  return createPortal(
    <div className="qts-toast-stack" role="status" aria-live="polite">
      <AnimatePresence>
        <motion.div
          key={message}
          className={`qts-toast qts-toast-${tone}`}
          initial={{ opacity: 0, y: -16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={{ duration: 0.2 }}
        >
          <Icon name={tone === "error" ? "exclamationTriangle" : "checkLg"} className="qts-toast-icon" />
          <div className="qts-toast-body">
            <p className="qts-toast-message">{message}</p>
            {action ? (
              <button type="button" className="qts-toast-action" onClick={action.onClick}>
                {action.label}
              </button>
            ) : null}
          </div>
          <button type="button" className="qts-toast-close" aria-label={closeLabel} onClick={onClose}>
            <Icon name="xLg" />
          </button>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}
