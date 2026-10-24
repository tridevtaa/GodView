import {
  DownloadSimple,
  ArrowsDownUp,
  SortAscending,
  SortDescending,
  ArrowClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LockSimple,
  Sparkle,
  Bell,
  BookOpenText,
  Briefcase,
  Bus,
  Cake,
  CalendarCheck,
  Camera,
  CaretDown,
  CaretLeft,
  ChartBar,
  ChalkboardTeacher,
  ChatCircleText,
  Check,
  CurrencyInr,
  EnvelopeSimple,
  FileText,
  GearSix,
  GenderFemale,
  GenderMale,
  GraduationCap,
  HandsPraying,
  Hash,
  IdentificationCard,
  MagnifyingGlass,
  MapPin,
  CalendarBlank,
  CaretRight,
  Confetti,
  Exam,
  Flag,
  ImageSquare,
  Lightning,
  SunHorizon,
  UsersFour,
  MegaphoneSimple,
  PushPin,
  MapTrifold,
  Note,
  PaperPlaneRight,
  PaperPlaneTilt,
  PencilSimple,
  Phone,
  Plus,
  PlusSquare,
  SignOut,
  SquaresFour,
  House,
  Student,
  Table,
  Tag,
  Trash,
  Tray,
  Trophy,
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
  sort: ArrowsDownUp,
  download: DownloadSimple,
  // Low to high points up, high to low down (Phosphor's "Descending" icon
  // is the one with the arrow up)
  sortUp: SortDescending,
  sortDown: SortAscending,
  search: MagnifyingGlass,
  plus: Plus,
  create: PlusSquare,
  // Navigation: a scholar in a cap, a paper plane, a teacher at the board.
  scholar: Student,
  plane: PaperPlaneTilt,
  teacher: ChalkboardTeacher,
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
  home: House,
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
  notice: MegaphoneSimple,
  calendar: CalendarBlank,
  chevronRight: CaretRight,
  image: ImageSquare,
  // Calendar kinds
  holiday: SunHorizon,
  exam: Exam,
  event: Confetti,
  meeting: UsersFour,
  flag: Flag,
  pushpin: PushPin,
  bus: Bus,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  sparkle: Sparkle,
  refresh: ArrowClockwise,
  lock: LockSimple,
  users: UsersThree,
  rupee: CurrencyInr,
  inbox: Tray,
  briefcase: Briefcase,
  settings: GearSix,
  chart: ChartBar,
  register: CalendarCheck,
  academics: GraduationCap,
  newAdmission: UserPlus,
  book: BookOpenText,
  note: Note,
  male: GenderMale,
  female: GenderFemale,
  file: FileText,
  bell: Bell,
  trophy: Trophy,
  lightning: Lightning,
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

// WhatsApp's own logo, in its colours (green bubble, white phone), for
// the buttons that open a WhatsApp chat.
export function WhatsAppLogo({ size = 24, className = "" }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 175.216 175.552" aria-hidden="true">
      <defs>
        <linearGradient id="wa-green" x1="85.915" x2="86.535" y1="32.567" y2="137.092" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#57d163" />
          <stop offset="1" stopColor="#23b33a" />
        </linearGradient>
      </defs>
      <path fill="#fff" d="m12.966 161.238 10.439-38.114a73.42 73.42 0 0 1-9.821-36.772c.017-40.556 33.021-73.55 73.578-73.55 19.681.01 38.154 7.669 52.047 21.572s21.537 32.383 21.53 52.037c-.018 40.553-33.027 73.553-73.578 73.553h-.032c-12.313-.005-24.412-3.094-35.159-8.954z" />
      <path fill="url(#wa-green)" d="M87.184 25.227c-33.733 0-61.166 27.423-61.178 61.13a60.98 60.98 0 0 0 9.349 32.535l1.455 2.313-6.179 22.558 23.146-6.069 2.235 1.324c9.387 5.571 20.15 8.517 31.126 8.523h.023c33.707 0 61.14-27.426 61.153-61.135a60.75 60.75 0 0 0-17.895-43.251 60.75 60.75 0 0 0-43.235-17.928z" />
      <path fill="#fff" fillRule="evenodd" d="M68.772 55.603c-1.378-3.061-2.828-3.123-4.137-3.176l-3.524-.043c-1.226 0-3.218.46-4.902 2.3s-6.435 6.287-6.435 15.332 6.588 17.785 7.506 19.013 12.718 20.381 31.405 27.75c15.529 6.124 18.689 4.906 22.061 4.6s10.877-4.447 12.408-8.74 1.532-7.971 1.073-8.74-1.685-1.226-3.525-2.146-10.877-5.367-12.562-5.981-2.91-.919-4.137.921-4.746 5.979-5.819 7.206-2.144 1.381-3.984.462-7.76-2.861-14.784-9.124c-5.465-4.873-9.154-10.891-10.228-12.73s-.114-2.835.808-3.751c.825-.824 1.838-2.147 2.759-3.22s1.224-1.84 1.836-3.065.307-2.301-.153-3.22-4.032-10.011-5.666-13.647" />
    </svg>
  );
}
