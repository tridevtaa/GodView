import { supabase } from "../supabase.js";

// Home layouts, saved per signed-in person so they follow them across
// devices (HomeWidgets.jsx keeps a copy in the browser for a quick start).

export async function loadHomeLayout(scope) {
  const { data, error } = await supabase.from("home_layouts").select("layout, updated_at").eq("scope", scope).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveHomeLayout(scope, layout) {
  if (!layout) {
    const { error } = await supabase.from("home_layouts").delete().eq("scope", scope);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("home_layouts").upsert({ scope, layout, updated_at: new Date().toISOString() }, { onConflict: "user_id,scope" });
  if (error) throw error;
}
