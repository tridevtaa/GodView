// The part of the screen people can actually see, as CSS variables on the
// page: --vv-h (its height), --vv-top (how far iOS has scrolled it) and
// --kb (how much of the page the on-screen keyboard covers), plus the
// kb-open class while it is up. iPhones put
// the keyboard over the page without shrinking it, so anything pinned to
// the bottom (sheets, dialogs, the search) uses these to sit above it.

const vv = window.visualViewport;
const isField = (el) => el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

// Whatever field is focused stays clear of the keyboard — and of any bar a
// keyboard draws on top of it (iOS's QuickType row, Gboard's suggestion
// strip…), which isn't always reflected in visualViewport's own height, so
// --kb below can be a little short. Checked (not assumed) against the
// field's actual position each time, with room to spare, rather than a
// blind re-centre that can land flush against that extra bar.
const KB_MARGIN = 48;
function keepFocusedClear() {
  const el = document.activeElement;
  if (!isField(el)) return;
  const rect = el.getBoundingClientRect();
  const top = vv ? vv.offsetTop : 0;
  const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  if (rect.bottom > bottom - KB_MARGIN || rect.top < top + KB_MARGIN) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

if (vv) {
  const root = document.documentElement.style;
  const fit = () => {
    root.setProperty("--vv-h", `${Math.round(vv.height)}px`);
    root.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.setProperty("--kb", `${kb}px`);
    document.documentElement.classList.toggle("kb-open", kb > 120);
    // The keyboard (and any bar on it) is mid-animation across several of
    // these, not settled after one guessed delay — recheck on each resize.
    keepFocusedClear();
  };
  fit();
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
}

document.addEventListener("focusin", (e) => {
  if (!isField(e.target)) return;
  // Covers browsers without visualViewport, and the moment right after
  // focus, before the keyboard's resize events start arriving.
  setTimeout(keepFocusedClear, 300);
});
