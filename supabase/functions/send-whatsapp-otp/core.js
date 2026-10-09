// Decides whether and how to send a sign-in code over WhatsApp.
// Plain JavaScript with no platform imports, so it runs in the Supabase Edge
// Function (Deno) and can be tested with Node.

// "919876500001", "+91 98765 00001", "09876500001" → "+919876500001"; else null.
export function normaliseIndianMobile(phone) {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

// WhatsApp Cloud API message using an approved "Authentication" template with
// a copy-code button: the code fills the body and the button.
export function buildOtpMessage(e164, otp, template, language = "en") {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: e164.replace(/^\+/, ""),
    type: "template",
    template: {
      name: template,
      language: { code: language },
      components: [
        { type: "body", parameters: [{ type: "text", text: otp }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otp }] },
      ],
    },
  };
}

const fail = (http_code, message) => ({ status: http_code, body: { error: { http_code, message } } });

// deps: isLinked(e164) → boolean, send(message) → { ok, status, text() }
export async function handleSendSms({ phone, otp }, { isLinked, send, template, language }) {
  const e164 = normaliseIndianMobile(phone);
  if (!e164) return fail(400, "Enter a 10-digit Indian mobile number.");
  if (!/^\d{4,10}$/.test(String(otp ?? ""))) return fail(400, "Invalid code.");

  // Only numbers a school has linked to a student get a message. Stops
  // strangers from triggering paid messages to arbitrary numbers.
  if (!(await isLinked(e164))) {
    return fail(403, "This number isn’t linked to any student yet. Ask your school to add it.");
  }

  const res = await send(buildOtpMessage(e164, String(otp), template, language));
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return fail(502, `WhatsApp didn’t accept the message (${res.status}). ${detail.slice(0, 200)}`.trim());
  }
  return { status: 200, body: {} };
}
