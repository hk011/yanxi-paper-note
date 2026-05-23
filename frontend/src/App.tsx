import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import ModelsPage from "./pages/ModelsPage";
import PaperPage from "./pages/PaperPage";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthBootstrap() {
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthBootstrap />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <HomePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/models"
          element={
            <PrivateRoute>
              <ModelsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/papers/:id"
          element={
            <PrivateRoute>
              <PaperPage />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
