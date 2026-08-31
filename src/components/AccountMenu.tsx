import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Users } from "lucide-react";
import { useAuth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function AccountMenu() {
  const { employee } = useAuth();
  const navigate = useNavigate();

  if (!employee) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="hidden text-right sm:block">
        <p className="font-medium leading-tight text-foreground">{employee.naam || employee.email}</p>
        <p className="text-xs text-muted-foreground">{employee.rol === "eigenaar" ? "Eigenaar" : "Medewerker"}</p>
      </div>
      {employee.rol === "eigenaar" && (
        <Button size="sm" variant="ghost" asChild>
          <Link to="/instellingen" search={{ tab: "team" }}>
            <Users className="size-4" /> Team
          </Link>
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void signOut().then(() => void navigate({ to: "/login" }));
        }}
      >
        <LogOut className="size-4" /> Uitloggen
      </Button>
    </div>
  );
}
