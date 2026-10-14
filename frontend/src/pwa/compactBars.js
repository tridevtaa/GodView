// Phones: scrolling down squeezes the bottom bars (tab bar, search, +)
// into a smaller size so more of the page shows, like Instagram; scrolling
// back up, or reaching the top, brings them back. Sets bars-compact on the
// page; the sizes are in App.css.

const root = document.documentElement;
const phone = window.matchMedia("(max-width: 760px)");
let last = window.scrollY;

function onScroll() {
  const y = window.scrollY;
  const moved = y - last;
  if (Math.abs(moved) < 8 && y > 40) return; // ignore small wobbles
  last = y;
  // Not while typing in the search: it sits on the keyboard then.
  const compact = phone.matches && y > 80 && moved > 0 && !root.classList.contains("is-typing");
  if (compact || moved < 0 || y <= 40) root.classList.toggle("bars-compact", compact);
}

window.addEventListener("scroll", onScroll, { passive: true });
