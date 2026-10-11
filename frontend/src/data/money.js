// Rupee formatting and amounts in words (Indian system: lakh, crore).

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
export const rupees = (n) => inr.format(Number(n) || 0).replace(/\.00$/, "");

// Short Indian form for big totals: ₹1.32 Cr, ₹94.4 L. Smaller amounts as usual.
export function rupeesShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1).replace(/\.0$/, "")} L`;
  return rupees(v);
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

// 12345.5 -> "Twelve Thousand Three Hundred Forty Five Rupees and Fifty Paise Only"
export function amountInWords(amount) {
  const value = Math.round((Number(amount) || 0) * 100);
  let r = Math.floor(value / 100);
  const paise = value % 100;
  if (r === 0 && paise === 0) return "Zero Rupees Only";
  const parts = [];
  const crore = Math.floor(r / 1e7);
  r %= 1e7;
  const lakh = Math.floor(r / 1e5);
  r %= 1e5;
  const thousand = Math.floor(r / 1e3);
  r %= 1e3;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (r) parts.push(belowThousand(r));
  const rupeePart = parts.length ? `${parts.join(" ")} ${Math.floor(value / 100) === 1 ? "Rupee" : "Rupees"}` : "";
  const paisePart = paise ? `${belowHundred(paise)} Paise` : "";
  return `${[rupeePart, paisePart].filter(Boolean).join(" and ")} Only`;
}

export const METHODS = {
  cash: "Cash",
  cheque: "Cheque",
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
  bank_transfer: "Bank transfer",
  online: "Online",
};
