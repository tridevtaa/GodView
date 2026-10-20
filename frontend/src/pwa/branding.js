import { useEffect } from "react";
import { logoUrl } from "../data/api.js";

// Once someone's signed in, the browser tab shows their school: its logo as
// the tab icon and its name in the title. Godview's own icon and title come
// back if the school has no logo, or when the screen goes away.
// (The installed app's home screen icon stays Godview's: that comes from the
// manifest, which can't change per school.)

const GODVIEW_TITLE = "Godview | School management for Indian schools";

export function useSchoolBranding(school) {
  const logo = school?.logo_path ? logoUrl(school.logo_path) : "";
  const name = school?.short_name || school?.name || "";

  useEffect(() => {
    const icons = [...document.querySelectorAll('link[rel="icon"]')];
    const original = icons.map((l) => [l, l.getAttribute("href"), l.getAttribute("type")]);
    if (logo) {
      icons.forEach((l) => {
        l.setAttribute("href", logo);
        l.setAttribute("type", "image/png");
      });
    }
    document.title = name ? `${name} · Godview` : GODVIEW_TITLE;
    return () => {
      original.forEach(([l, href, type]) => {
        l.setAttribute("href", href);
        if (type) l.setAttribute("type", type);
      });
      document.title = GODVIEW_TITLE;
    };
  }, [logo, name]);
}
