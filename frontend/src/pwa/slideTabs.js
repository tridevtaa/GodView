// Tab groups across the app: the highlight slides to the tab picked
// instead of jumping. Each group gets data-slide and its active tab's box as
// CSS variables; App.css draws the pill (or underline) from them. Works on
// any group matching GROUPS with no change to the screens themselves.
// (The phone tab bar has its own glass bubble and is left alone.)
const GROUPS = ".segmented, .topbar-tabs, .sub-nav-scroll, .ig-tabs";
const ACTIVE = ":scope > .active, :scope > .is-on, :scope > .is-current";

function place(group) {
  const on = group.querySelector(ACTIVE);
  const s = group.style;
  if (!on || !on.offsetWidth) {
    s.setProperty("--slide-o", "0");
    return;
  }
  const g = group.getBoundingClientRect();
  const b = on.getBoundingClientRect();
  s.setProperty("--slide-x", `${b.left - g.left - group.clientLeft + group.scrollLeft}px`);
  s.setProperty("--slide-y", `${b.top - g.top - group.clientTop + group.scrollTop}px`);
  s.setProperty("--slide-w", `${b.width}px`);
  s.setProperty("--slide-h", `${b.height}px`);
  s.setProperty("--slide-o", "1");
}

const sizes = typeof ResizeObserver === "function" ? new ResizeObserver((list) => list.forEach((e) => place(e.target))) : null;
let queued = false;

function scan() {
  queued = false;
  document.querySelectorAll(GROUPS).forEach((group) => {
    if (!group.hasAttribute("data-slide")) {
      // Placed first without motion, so it doesn't fly in from the left
      group.setAttribute("data-slide", "");
      place(group);
      sizes?.observe(group);
      requestAnimationFrame(() => group.setAttribute("data-slide", "on"));
    } else {
      place(group);
    }
  });
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(scan);
}

if (typeof window !== "undefined" && typeof MutationObserver === "function") {
  new MutationObserver(queue).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", queue);
  document.fonts?.ready.then(queue);
  queue();
}
