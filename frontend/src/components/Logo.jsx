export default function Logo() {
  return (
    <a className="logo" href="/" aria-label="Godview home">
      <svg viewBox="0 0 100 86" width="38" height="33" aria-hidden="true">
        <polygon points="50,0 100,86 0,86" fill="#74bff2" />
        <circle cx="50" cy="56" r="26" fill="#070f99" />
        <circle cx="50" cy="56" r="14" fill="#fff" />
        <circle cx="50" cy="56" r="9" fill="#74bff2" />
        <circle cx="50" cy="56" r="4.5" fill="#150b14" />
      </svg>
      <span>Godview</span>
    </a>
  );
}
