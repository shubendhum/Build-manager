import { createContext, useContext, useState, useEffect } from "react";
import api, { setOnUnauthorized } from "@/lib/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  // null = checking, false = not authenticated, object = authenticated user
  const [user, setUser] = useState(null);

  useEffect(() => {
    setOnUnauthorized(() => setUser(false));
    api.get("/auth/me")
      .then(({ data }) => setUser(data))
      .catch(() => setUser(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
  };

  const register = async (name, email, password) => {
    const { data } = await api.post("/auth/register", { name, email, password });
    setUser(data);
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) { /* cookie may already be gone */ }
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
