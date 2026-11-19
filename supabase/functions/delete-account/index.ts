// Delete my account (My profile, staff and parents). Checks who is asking
// from their sign-in, removes their data with delete_account_data() (which
// refuses a school's only owner), their files through Storage, and then
// their sign-in, which takes their push devices with it.
//
// Deploy with:
//   npx supabase functions deploy delete-account
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method" }, 405);

  const { confirm } = await req.json().catch(() => ({}));
  if (confirm !== "DELETE") return reply({ error: "bad_request" }, 400);

  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await user.auth.getUser();
  const id = auth?.user?.id;
  if (!id) return reply({ error: "signed_out" }, 401);

  const { data: files, error } = await admin.rpc("delete_account_data", { p_user: id });
  if (error) {
    if (error.hint === "sole-owner") return reply({ error: "sole_owner" }, 409);
    console.error("delete_account_data", error.message);
    return reply({ error: "failed" }, 500);
  }

  // Files: a leftover file is unreachable once the rows and sign-in are
  // gone, so a failure here is logged, not shown.
  const byBucket = new Map<string, string[]>();
  for (const f of (files ?? []) as { bucket: string; path: string }[]) {
    byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  }
  for (const [bucket, paths] of byBucket) {
    const { error: e } = await admin.storage.from(bucket).remove(paths);
    if (e) console.error("remove files", bucket, e.message);
  }

  const { error: e } = await admin.auth.admin.deleteUser(id);
  if (e) {
    console.error("deleteUser", e.message);
    return reply({ error: "failed" }, 500);
  }
  return reply({ ok: true });
});
