import { useState } from "react";
import { Navigate } from "react-router-dom";
import { HardHat, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/lib/api";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user && user !== false) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (mode) => async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const fieldCls = "bg-slate-800/50 border-slate-600";

  return (
    <div className="min-h-screen bg-background blueprint-grid flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-11 w-11 rounded-md bg-amber-500 flex items-center justify-center">
            <HardHat className="h-6 w-6 text-slate-950" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-100">
              BuildManager <span className="text-amber-400">VIC</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Project management for Victorian builders</p>
          </div>
        </div>

        <div className="rounded-md border border-slate-700 bg-card p-6">
          <Tabs defaultValue="login" onValueChange={() => setError("")}>
            <TabsList className="grid grid-cols-2 w-full bg-slate-800/60">
              <TabsTrigger value="login" data-testid="login-tab">Sign In</TabsTrigger>
              <TabsTrigger value="register" data-testid="register-tab">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={submit("login")} className="space-y-4 mt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email" className="text-xs uppercase tracking-[0.15em] text-slate-400">Email</Label>
                  <Input id="login-email" data-testid="login-email-input" type="email" required className={fieldCls}
                    value={form.email} onChange={set("email")} placeholder="pm@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login-password" className="text-xs uppercase tracking-[0.15em] text-slate-400">Password</Label>
                  <Input id="login-password" data-testid="login-password-input" type="password" required className={fieldCls}
                    value={form.password} onChange={set("password")} placeholder="••••••••" />
                </div>
                <Button type="submit" data-testid="login-submit-button" disabled={busy}
                  className="w-full bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Sign In"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form onSubmit={submit("register")} className="space-y-4 mt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="register-name" className="text-xs uppercase tracking-[0.15em] text-slate-400">Name</Label>
                  <Input id="register-name" data-testid="register-name-input" required className={fieldCls}
                    value={form.name} onChange={set("name")} placeholder="Your name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-email" className="text-xs uppercase tracking-[0.15em] text-slate-400">Email</Label>
                  <Input id="register-email" data-testid="register-email-input" type="email" required className={fieldCls}
                    value={form.email} onChange={set("email")} placeholder="pm@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-password" className="text-xs uppercase tracking-[0.15em] text-slate-400">Password</Label>
                  <Input id="register-password" data-testid="register-password-input" type="password" required minLength={8} className={fieldCls}
                    value={form.password} onChange={set("password")} placeholder="Min 8 characters" />
                </div>
                <Button type="submit" data-testid="register-submit-button" disabled={busy}
                  className="w-full bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Create Account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {error && (
            <p data-testid="auth-error" className="mt-4 text-sm text-red-400 border border-red-500/30 bg-red-500/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
