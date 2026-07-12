import { NavLink, Outlet } from "react-router-dom";
import { HardHat, LayoutDashboard, FolderKanban, ScanSearch, LogOut, Hammer, BookOpen } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, testId: "nav-dashboard" },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: false, testId: "nav-projects" },
  { to: "/trades", label: "Trades", icon: Hammer, end: false, testId: "nav-trades" },
  { to: "/rates", label: "Rate Guide", icon: BookOpen, end: false, testId: "nav-rates" },
  { to: "/analyzer", label: "Photo Analyzer", icon: ScanSearch, end: false, testId: "nav-analyzer" },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors duration-200 ${
    isActive ? "bg-amber-500/10 text-amber-400" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
  }`;

export const AppShell = () => {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-background blueprint-grid">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-slate-800 bg-slate-900/80 backdrop-blur-xl z-40">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
          <div className="h-9 w-9 rounded-md bg-amber-500 flex items-center justify-center shrink-0">
            <HardHat className="h-5 w-5 text-slate-950" aria-hidden="true" />
          </div>
          <div>
            <p className="font-heading text-base font-bold tracking-tight text-slate-100 leading-none">
              BuildManager <span className="text-amber-400">VIC</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mt-1">Victorian Builds</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} data-testid={item.testId}>
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-slate-800">
          <p className="text-sm text-slate-200 font-medium truncate" data-testid="user-name">{user?.name}</p>
          <p className="text-xs text-slate-500 truncate">{user?.email}</p>
          <button
            data-testid="logout-button"
            onClick={logout}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:text-amber-400 hover:border-amber-500/50 transition-colors duration-200"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 backdrop-blur-xl bg-slate-900/85 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-amber-500 flex items-center justify-center">
            <HardHat className="h-4 w-4 text-slate-950" aria-hidden="true" />
          </div>
          <p className="font-heading text-sm font-bold text-slate-100">BuildManager <span className="text-amber-400">VIC</span></p>
        </div>
        <div className="flex items-center gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} data-testid={`${item.testId}-mobile`}
              className={({ isActive }) => `p-2 rounded-md ${isActive ? "text-amber-400 bg-amber-500/10" : "text-slate-400"}`}>
              <item.icon className="h-5 w-5" aria-hidden="true" />
            </NavLink>
          ))}
          <button data-testid="logout-button-mobile" onClick={logout} className="p-2 rounded-md text-slate-400 hover:text-amber-400">
            <LogOut className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="md:pl-60">
        <Outlet />
      </div>
    </div>
  );
};
