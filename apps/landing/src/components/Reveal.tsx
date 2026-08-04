import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

// Shared scroll-reveal primitive: fades a block in and rises it a few pixels the first time it
// enters the viewport. One definition here (instead of ad-hoc motion props copy-pasted per
// section) keeps every section's entrance feeling like the same product, and is the single place
// that has to get prefers-reduced-motion right - useReducedMotion() flips this to a plain,
// instant appearance with no transform/opacity animation at all when the visitor has that
// preference set, rather than just a faster version of the same motion.
//
// Deliberately a narrow prop surface (not the full native <div> event-handler set): Framer
// Motion's own onAnimation*/onDrag* props collide in type with the native DOM events of the same
// name, so this only forwards what every call site actually needs.
// "div" and "figure" only: those are the tags call sites actually need so far. Extend this list
// deliberately, don't default to accepting any string - CSS Grid/Flex parents in this codebase
// often style their DIRECT child by tag/class (e.g. `.qts-semiauto-inner > figure`), so Reveal
// must render as that exact element itself rather than wrapping it in an extra, unstyled div -
// which is exactly the bug this component shipped with once (the wrapped element fell out of its
// parent grid's sizing rules with no visible error, just a collapsed/invisible layout).
const REVEAL_TAGS = { div: motion.div, figure: motion.figure };
type RevealTag = keyof typeof REVEAL_TAGS;

interface RevealProps {
  as?: RevealTag;
  delay?: number;
  className?: string;
  id?: string;
  children: ReactNode;
}

export function Reveal({ as = "div", delay = 0, className, id, children }: RevealProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    const Tag = as;
    return <Tag className={className} id={id}>{children}</Tag>;
  }
  const MotionTag = REVEAL_TAGS[as];
  return (
    <MotionTag
      className={className}
      id={id}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </MotionTag>
  );
}
