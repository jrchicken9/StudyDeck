import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
} from "react-router-dom";
import AppLayout from "./components/AppLayout";
import BannedAccountGate from "./components/BannedAccountGate";
import PageTransition from "./components/PageTransition";
import RequireAdmin from "./components/RequireAdmin";
import RequireExamAccess from "./components/RequireExamAccess";
import RequireSession from "./components/RequireSession";
import { AuthProvider } from "./context/AuthContext";
import AccountModerationPage from "./pages/AccountModerationPage";
import AdminLayout from "./components/AdminLayout";
import AdminApprovalsPage from "./pages/AdminApprovalsPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import CommunityHomePage from "./pages/CommunityHomePage";
import PublisherProfilePage from "./pages/PublisherProfilePage";
import MyTestsPage from "./pages/MyTestsPage";
import MyBankCreatePage from "./pages/MyBankCreatePage";
import MyBankEditPage from "./pages/MyBankEditPage";
import MyBanksPage from "./pages/MyBanksPage";
import MyBankSessionPage from "./pages/MyBankSessionPage";
import LoginPage from "./pages/LoginPage";
import PendingApprovalPage from "./pages/PendingApprovalPage";
import ProfilePage from "./pages/ProfilePage";
import QuizPage from "./pages/QuizPage";
import ResultsPage from "./pages/ResultsPage";
import SessionPage from "./pages/SessionPage";
import SignupPage from "./pages/SignupPage";
import WelcomePage from "./pages/WelcomePage";

function AppShell() {
  return (
    <div className="app-shell">
      <div className="app-bg" aria-hidden />
      <Outlet />
    </div>
  );
}

function AuthProviderLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export const appRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AuthProviderLayout />}>
      <Route element={<AppShell />}>
        <Route
          path="/"
          element={
            <PageTransition>
              <WelcomePage />
            </PageTransition>
          }
        />
        <Route
          path="/auth/login"
          element={
            <PageTransition>
              <LoginPage />
            </PageTransition>
          }
        />
        <Route
          path="/auth/signup"
          element={
            <PageTransition>
              <SignupPage />
            </PageTransition>
          }
        />
        <Route element={<AppLayout />}>
          <Route element={<RequireSession />}>
            <Route path="account/moderation" element={<AccountModerationPage />} />
            <Route element={<BannedAccountGate />}>
              <Route path="profile" element={<ProfilePage />} />
              <Route path="pending-approval" element={<PendingApprovalPage />} />
              <Route element={<RequireExamAccess />}>
                <Route path="dashboard" element={<Navigate to="/community" replace />} />
                <Route path="community" element={<CommunityHomePage />} />
                <Route path="community/publisher/:publisherId" element={<PublisherProfilePage />} />
                <Route path="my-tests" element={<MyTestsPage />} />
                <Route path="exams/:examId" element={<SessionPage />} />
                <Route path="quiz/:examId" element={<QuizPage />} />
                <Route path="results/:examId" element={<ResultsPage />} />
                <Route path="my-banks" element={<MyBanksPage />} />
                <Route path="my-banks/new" element={<MyBankCreatePage />} />
                <Route path="my-banks/:bankId" element={<MyBankEditPage />} />
                <Route path="my-banks/:bankId/practice" element={<MyBankSessionPage />} />
              </Route>
              <Route element={<RequireAdmin />}>
                <Route path="admin" element={<AdminLayout />}>
                  <Route index element={<Navigate to="approvals" replace />} />
                  <Route path="approvals" element={<AdminApprovalsPage />} />
                  <Route path="users" element={<AdminUsersPage />} />
                </Route>
              </Route>
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Route>,
  ),
);
