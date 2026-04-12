import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import RequireSession from "./components/RequireSession";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import QuizPage from "./pages/QuizPage";
import ResultsPage from "./pages/ResultsPage";
import SessionPage from "./pages/SessionPage";
import SignupPage from "./pages/SignupPage";
import WelcomePage from "./pages/WelcomePage";

export default function App() {
  return (
    <div className="app-shell">
      <div className="app-bg" aria-hidden />
      <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/signup" element={<SignupPage />} />
      <Route element={<AppLayout />}>
        <Route element={<RequireSession />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="exams/:examId" element={<SessionPage />} />
          <Route path="quiz/:examId" element={<QuizPage />} />
          <Route path="results/:examId" element={<ResultsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </div>
  );
}
