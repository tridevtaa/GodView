import { useAuth } from "./AuthGate.jsx";
import { logoUrl } from "../data/api.js";

export function LogoMark({ size = 28 }) {
  return (
    <svg viewBox="0 0 100 86" width={size} height={(size * 86) / 100} aria-hidden="true">
      <polygon points="50,0 100,86 0,86" fill="#74bff2" />
      <circle cx="50" cy="56" r="26" fill="#070f99" />
      <circle cx="50" cy="56" r="14" fill="#fff" />
      <circle cx="50" cy="56" r="9" fill="#74bff2" />
      <circle cx="50" cy="56" r="4.5" fill="#150b14" />
    </svg>
  );
}

// "Godview × <school>" — the school's logo if it has one, else its name.
export default function Logo() {
  const school = useAuth()?.school;
  const label = school?.short_name || school?.name;
  return (
    <a className="logo" href="/" aria-label={`Godview${label ? ` for ${label}` : ""} — home`}>
      <LogoMark size={26} />
      <span className="logo-word">Godview</span>
      {school && (
        <>
          <span className="logo-x" aria-hidden="true">×</span>
          {school.logo_path ? (
            <img className="logo-partner" src={logoUrl(school.logo_path)} alt={label} />
          ) : (
            <span className="logo-school">{label}</span>
          )}
        </>
      )}
    </a>
  );
}
