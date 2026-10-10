import gsap from "gsap";

/** Entrance animations only when someone can see them: never in a background tab (frames are paused, content
 *  would stay invisible) and never with reduced motion. */
export function canAnimate() {
  if (typeof window === "undefined") return false;
  return document.visibilityState === "visible" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Safety net: whatever happens, entrance tweens are finished after `ms`. */
export function finishAfter(tl: gsap.core.Animation, ms = 2500) {
  const t = setTimeout(() => tl.progress(1), ms);
  return () => clearTimeout(t);
}
