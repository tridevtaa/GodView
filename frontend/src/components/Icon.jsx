import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Briefcase,
  Bus,
  Cake,
  CalendarCheck,
  Camera,
  CaretDown,
  CaretLeft,
  ChartBar,
  ChatCircleText,
  Check,
  CurrencyInr,
  EnvelopeSimple,
  FileText,
  GearSix,
  GenderFemale,
  GenderMale,
  HandsPraying,
  Hash,
  IdentificationCard,
  MagnifyingGlass,
  MapPin,
  MapTrifold,
  Note,
  PaperPlaneRight,
  PencilSimple,
  Phone,
  Plus,
  SignOut,
  SquaresFour,
  Table,
  Tag,
  Trash,
  Tray,
  UploadSimple,
  UserPlus,
  UsersThree,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";

// App icons: Phosphor, sized and coloured by CSS (currentColor). Weight is
// "regular" for controls; "duotone" where an icon carries meaning on its
// own (navigation, the student's facts).
const PHOSPHOR = {
  search: MagnifyingGlass,
  plus: Plus,
  upload: UploadSimple,
  chevronDown: CaretDown,
  chevronLeft: CaretLeft,
  check: Check,
  x: X,
  edit: PencilSimple,
  camera: Camera,
  logout: SignOut,
  phone: Phone,
  message: ChatCircleText,
  send: PaperPlaneRight,
  trash: Trash,
  grid: SquaresFour,
  map: MapTrifold,
  cake: Cake,
  mail: EnvelopeSimple,
  table: Table,
  whatsapp: WhatsappLogo,
  tag: Tag,
  religion: HandsPraying,
  star: HandsPraying,
  idcard: IdentificationCard,
  hash: Hash,
  pin: MapPin,
  bus: Bus,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  users: UsersThree,
  rupee: CurrencyInr,
  inbox: Tray,
  briefcase: Briefcase,
  settings: GearSix,
  chart: ChartBar,
  register: CalendarCheck,
  newAdmission: UserPlus,
  book: BookOpenText,
  note: Note,
  male: GenderMale,
  female: GenderFemale,
  file: FileText,
};

// Father and mother, drawn in Phosphor's style (256 grid, soft fill under a
// line): a man in a shirt and a woman with long hair in a dress.
const PARENTS = {
  // Short hair, broad shoulders, open collar and a tie.
  father: (duo) => (
    <>
      {duo && <path d="M128 132a44 44 0 1 0 0-88 44 44 0 0 0 0 88Z M32 232c4-44 44-76 96-76s92 32 96 76Z" opacity="0.2" />}
      <circle cx="128" cy="88" r="44" fill="none" stroke="currentColor" strokeWidth="16" />
      <path d="M32 232c4-44 44-76 96-76s92 32 96 76" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
      <path d="M128 160l-16 18 16 54 16-54Z" fill="currentColor" />
    </>
  ),
  // Long hair falling past the shoulders and a flared dress.
  mother: (duo) => (
    <>
      {duo && <path d="M70 150c-20-30-20-76 6-104a72 72 0 0 1 104 0c26 28 26 74 6 104Z M40 232l18-38c12-24 40-38 70-38s58 14 70 38l18 38Z" opacity="0.2" />}
      <path d="M70 150c-20-30-20-76 6-104a72 72 0 0 1 104 0c26 28 26 74 6 104" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
      <circle cx="128" cy="96" r="38" fill="none" stroke="currentColor" strokeWidth="16" />
      <path d="M40 232l18-38c12-24 40-38 70-38s58 14 70 38l18 38" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

export default function Icon({ name, size = 16, className = "", weight = "regular" }) {
  const P = PHOSPHOR[name];
  if (P) return <P className={`icon ${className}`} size={size} weight={weight} aria-hidden="true" />;
  const draw = PARENTS[name];
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      {draw?.(weight === "duotone")}
    </svg>
  );
}
