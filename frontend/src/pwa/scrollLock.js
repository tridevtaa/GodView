// While any pop-up (.modal-backdrop) is open, freeze the page behind it.
// iPhone Safari ignores overflow: hidden on <body> for touch scrolling, so
// the body is pinned with position: fixed at its current offset and put back
// exactly where it was when the last pop-up closes. Works for every pop-up,
// including ones rendered into <body> through a portal.

let lockedAt = null;

function lock() {
  if (lockedAt !== null) return;
  lockedAt = window.scrollY;
  const b = document.body.style;
  b.position = "fixed";
  b.top = `-${lockedAt}px`;
  b.left = "0";
  b.right = "0";
  b.width = "100%";
  b.overflow = "hidden";
}

function unlock() {
  if (lockedAt === null) return;
  const y = lockedAt;
  lockedAt = null;
  const b = document.body.style;
  b.position = b.top = b.left = b.right = b.width = b.overflow = "";
  window.scrollTo(0, y);
}

const sync = () => (document.querySelector(".modal-backdrop") ? lock() : unlock());

new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
