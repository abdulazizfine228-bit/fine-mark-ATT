import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, Users, Briefcase } from "lucide-react";
import logo from "@/assets/finemark-logo.jpeg";

type Props = { isAdmin?: boolean; isView?: boolean };

export function AppHeader({ isAdmin }: Props) {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/dashboard" className="flex items-center gap-2">
          <img src={logo} alt="FineMark" className="h-9 w-auto object-contain" />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard"><LayoutDashboard className="mr-1 h-4 w-4" />Dashboard</Link>
          </Button>
          {isAdmin && (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin"><Users className="mr-1 h-4 w-4" />Admin</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/employees"><Briefcase className="mr-1 h-4 w-4" />Employees</Link>
              </Button>
            </>
          )}
        </nav>
        <Button variant="outline" size="sm" onClick={signOut}>
          <LogOut className="mr-1 h-4 w-4" />Sign out
        </Button>
      </div>
    </header>
  );
}
