// A new release replaced the app's files while this page still lists the
// old ones (the stored page opened on a slow connection, or a tab left open).
// Loading one of them fails; reloading picks up the new release. At most
// once a minute, so a real outage shows the error instead of looping.

const KEY = "godview.releaseReloadAt";

export const isStaleRelease = (error) =>
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|not a valid JavaScript MIME type/i.test(
    String(error?.message || error)
  );

// The database was updated past this page's code (a tab left open across a
// release): the call it makes no longer exists.
export const isOutdatedApp = (error) => error?.code === "PGRST202";

// Returns true if the page is reloading.
export function reloadForNewRelease() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) || 0) < 60000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false; // can't remember it, so don't risk a loop
  }
  window.location.reload();
  return true;
}
