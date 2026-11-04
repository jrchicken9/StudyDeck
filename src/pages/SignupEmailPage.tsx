import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import {
  isValidEmail,
  isValidFirstName,
  isValidLastName,
  passwordStrength,
} from "../lib/signupValidation";
import { StudyDeckBrand } from "../components/StudyDeckLogo";
import { useAuth } from "../context/AuthContext";
import {
  RequiredBadge,
  SignupNameFields,
  SignupPasswordFields,
  signupPasswordValid,
} from "../components/signup/SignupFormSections";

export default function SignupEmailPage() {
  const navigate = useNavigate();
  const { user, loading, signedInHomePath, signUpWithPassword } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const ready = isSupabaseConfigured();

  const emailTrim = useMemo(() => email.trim(), [email]);
  const emailOk = isValidEmail(emailTrim);

  useEffect(() => {
    if (loading || !user) return;
    navigate(signedInHomePath, { replace: true });
  }, [loading, user, signedInHomePath, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setAttemptedSubmit(true);
    if (!ready) return;

    if (!isValidFirstName(firstName) || !isValidLastName(lastName)) return;
    if (!emailOk) return;
    if (!signupPasswordValid(password, confirmPassword, true)) return;
    if (!passwordStrength(password).acceptable) return;
    if (password !== confirmPassword) return;

    setPending(true);
    const res = await signUpWithPassword(password, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: emailTrim,
      phone: "",
    });
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.needsEmailConfirm) {
      setInfo(
        "We sent a confirmation link to your email. Open it, then come back here to log in.",
      );
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card card auth-card--signup auth-surface">
        <header className="signup-header">
          <StudyDeckBrand
            layout="stack"
            logoClassName="auth-brand-logo"
            wordmarkClassName="eyebrow studydeck-wordmark studydeck-wordmark--compact studydeck-wordmark--serious"
          />
          <h1 className="page-title signup-title auth-page-title">Create account</h1>
          {ready ? (
            <p className="auth-subtitle">
              Sign up with your email. An admin approves your account before you can
              start a session.
            </p>
          ) : null}
        </header>

        {!ready ? (
          <>
            <p className="muted signup-unconfigured">
              Sign-up is not available until this app is connected to our account
              service.
            </p>
            <div className="auth-cta-stack">
              <Link
                to="/auth/signup"
                className="btn btn-welcome-secondary auth-cta-secondary"
              >
                Back to sign-up options
              </Link>
              <Link
                to="/auth/login"
                className="btn btn-welcome-secondary auth-cta-secondary"
              >
                Log in
              </Link>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit} className="auth-form signup-form" noValidate>
            <section className="signup-details-section" aria-label="Your details">
              <div className="signup-details-stack">
                <SignupNameFields
                  idPrefix="signup-email"
                  firstName={firstName}
                  lastName={lastName}
                  onFirstNameChange={setFirstName}
                  onLastNameChange={setLastName}
                  attemptedSubmit={attemptedSubmit}
                />

                <div className="signup-panel">
                  <div className="field field--signup">
                    <label className="signup-label" htmlFor="signup-email-address">
                      Email address <RequiredBadge />
                    </label>
                    <input
                      id="signup-email-address"
                      className={`input input--signup ${attemptedSubmit && !emailOk ? "input--invalid" : ""}`}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-required
                      aria-invalid={attemptedSubmit && !emailOk}
                      aria-describedby={
                        attemptedSubmit && !emailOk
                          ? "signup-email-address-hint"
                          : undefined
                      }
                    />
                    {attemptedSubmit && !emailOk ? (
                      <p
                        id="signup-email-address-hint"
                        className="field-hint field-hint--error"
                      >
                        Enter the email you will use to sign in.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <SignupPasswordFields
              idPrefix="signup-email"
              password={password}
              confirmPassword={confirmPassword}
              onPasswordChange={setPassword}
              onConfirmPasswordChange={setConfirmPassword}
              attemptedSubmit={attemptedSubmit}
            />

            {error ? <p className="auth-error">{error}</p> : null}
            {info ? <p className="auth-info">{info}</p> : null}

            <div className="auth-cta-stack">
              <button
                type="submit"
                className="btn btn-signup-primary"
                disabled={pending}
              >
                {pending ? "Creating account…" : "Create account"}
              </button>
            </div>
          </form>
        )}
        <footer className="auth-footer">
          <Link to="/auth/signup" className="auth-footer-link">
            ← Back to sign-up options
          </Link>
        </footer>
      </div>
    </div>
  );
}
