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

// "Godview × Mav.school" co-brand lockup for the header.
export default function Logo() {
  return (
    <a className="logo" href="/" aria-label="Godview for Mav.school — home">
      <LogoMark size={26} />
      <span className="logo-word">Godview</span>
      <span className="logo-x" aria-hidden="true">×</span>
      <img className="logo-partner" src="/mav-school.svg" alt="Mav.school" width="128" height="16" />
    </a>
  );
}
