import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const admin = createClient(url, service);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roles) return new Response(JSON.stringify({ error: "Admins only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

    const { email, password, full_name, employee_id, project_name, place, role } = await req.json();
    if (!email || !password) return new Response(JSON.stringify({ error: "email & password required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    if (employee_id) {
      const { data: existingProfile } = await admin.from("profiles").select("id").eq("employee_id", employee_id).maybeSingle();
      if (existingProfile) {
        return new Response(JSON.stringify({ error: "Employee ID already exists" }), { status: 409, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: full_name || email.split("@")[0], employee_id: employee_id || null },
    });
    if (error) throw error;

    if (created.user && (project_name || place)) {
      await admin.from("profiles").update({
        project_name: project_name || null,
        place: place || null,
      }).eq("id", created.user.id);
    }

    if (created.user && role && (role === "admin" || role === "user" || role === "view")) {
      await admin.from("user_roles").delete().eq("user_id", created.user.id);
      await admin.from("user_roles").insert({ user_id: created.user.id, role });
    }

    return new Response(JSON.stringify({ user: created.user }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Failed" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
