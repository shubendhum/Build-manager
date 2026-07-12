import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export const ProtectedRoute = ({ children }) => {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" data-testid="auth-loading">
        <Loader2 className="h-8 w-8 text-amber-400 animate-spin" aria-hidden="true" />
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  return children;
};
