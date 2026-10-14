// The part of the screen people can actually see, as CSS variables on the
// page: --vv-h (its height), --vv-top (how far iOS has scrolled it) and
// --kb (how much of the page the on-screen keyboard covers), plus the
// kb-open class while it is up. iPhones put
// the keyboard over the page without shrinking it, so anything pinned to
// the bottom (sheets, dialogs, the search) uses these to sit above it.

const vv = window.visualViewport;
if (vv) {
  const root = document.documentElement.style;
  const fit = () => {
    root.setProperty("--vv-h", `${Math.round(vv.height)}px`);
    root.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.setProperty("--kb", `${kb}px`);
    document.documentElement.classList.toggle("kb-open", kb > 120);
  };
  fit();
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
}
