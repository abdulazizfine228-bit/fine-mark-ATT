import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

export type Role = "admin" | "user" | "view";
export type Place = "Jeddah" | "Riyad" | "All" | null;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [place, setPlace] = useState<Place>(null);
  const [loading, setLoading] = useState(true);

  const loadMeta = async (uid: string) => {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
      supabase.from("profiles").select("place").eq("id", uid).maybeSingle(),
    ]);
    setRole((r?.role as Role) ?? "user");
    setPlace((p?.place as Place) ?? null);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const uid = session.user.id;
        setTimeout(() => { loadMeta(uid); }, 0);
      } else {
        setRole(null); setPlace(null);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) await loadMeta(session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, role, place, loading, isAdmin: role === "admin", isView: role === "view" };
}
