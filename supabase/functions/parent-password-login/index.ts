// Parent login, first time: checks the number + starting password (a linked
// child's first name and birth year) against the school's records, then
// creates or updates that parent's login so the app can sign in with it.
//
// The check itself lives in the database (parent_password_check), which also
// counts wrong attempts and locks a number after 5 in 15 minutes. Parents who
// set their own password are left alone. Deploy with:
//   npx supabase functions deploy parent-password-login --no-verify-jwt
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ result: "error" }, 405);

  const { phone, password } = await req.json().catch(() => ({}));
  if (typeof phone !== "string" || typeof password !== "string" || password.length > 100) {
    return reply({ result: "wrong" });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error } = await admin.rpc("parent_password_check", { p_phone: phone, p_password: password });
  if (error) return reply({ result: "error" }, 500);
  const verdict = rows?.[0];
  if (!verdict || verdict.result !== "ok") return reply({ result: verdict?.result ?? "wrong" });

  // Each successful check gives the login a fresh random password that only
  // the app uses, once. So the starting password can't be guessed against
  // the sign-in endpoint directly: every guess goes through the locked check.
  const key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  const { data: users, error: lookup } = await admin.rpc("parent_auth_user", { p_phone: verdict.phone });
  if (lookup) return reply({ result: "error" }, 500);
  const user = users?.[0];

  if (!user) {
    const { error: e } = await admin.auth.admin.createUser({ phone: verdict.phone, password: key, phone_confirm: true });
    if (e) return reply({ result: "error" }, 500);
  } else if (user.custom_password) {
    return reply({ result: "custom" }); // they chose their own password; the starting one no longer applies
  } else {
    const { error: e } = await admin.auth.admin.updateUserById(user.id, { password: key, phone_confirm: true });
    if (e) return reply({ result: "error" }, 500);
  }
  return reply({ result: "ok", phone: verdict.phone, key });
});
