import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import {
  contactFieldsHint,
  firstNameHint,
  getPasswordChecks,
  hasSignupContact,
  isValidEmail,
  isValidFirstName,
  isValidLastName,
  isValidPhoneDigits,
  passwordMeetsPolicy,
  phoneDigits,
} from "../lib/signupValidation";
import { StudyDeckBrand } from "../components/StudyDeckLogo";
import { useAuth } from "../context/AuthContext";

const PASSWORD_POLICY_ERROR =
  "Password must be at least 10 characters and include uppercase, lowercase, a number, and a symbol.";

function RequiredBadge() {
  return (
    <abbr className="field-required" title="Required" aria-label="required">
      *
    </abbr>
  );
}

export default function SignupPage() {
  const navigate = useNavigate();
  const { user, loading, signedInHomePath, signUpWithPassword } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const ready = isSupabaseConfigured();

  const digits = useMemo(() => phoneDigits(phone), [phone]);
  const emailTrim = useMemo(() => email.trim(), [email]);
  const emailOk = isValidEmail(emailTrim);
  const phoneOk = isValidPhoneDigits(digits);
  const contactOk = hasSignupContact(email, phone);
  const phonePartial = digits.length > 0 && !phoneOk;
  const emailPartial = emailTrim.length > 0 && !emailOk;
  const nameOk = isValidFirstName(firstName);
  const lastOk = isValidLastName(lastName);
  const pwdOk = passwordMeetsPolicy(password);
  const pwdChecks = useMemo(() => getPasswordChecks(password), [password]);
  const pwdPassed = pwdChecks.filter((c) => c.pass).length;
  const pwdMeterClass =
    pwdPassed === 5
      ? "password-meter--strong"
      : pwdPassed >= 3
        ? "password-meter--good"
        : pwdPassed >= 1
          ? "password-meter--fair"
          : "password-meter--weak";
  const pwdStrengthLabel = useMemo(() => {
    if (password.length === 0) return "";
    if (pwdPassed === 5) return "Strong";
    if (pwdPassed >= 3) return "Good";
    if (pwdPassed >= 1) return "Fair";
    return "Weak";
  }, [password.length, pwdPassed]);
  const pwdMeterPct =
    pwdChecks.length > 0 ? Math.round((pwdPassed / pwdChecks.length) * 100) : 0;
  const confirmMismatch =
    attemptedSubmit &&
    confirmPassword.length > 0 &&
    confirmPassword !== password;

  const contactInvalidVisual =
    attemptedSubmit &&
    !contactOk &&
    (emailPartial || phonePartial || (!emailTrim && !digits));

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

    if (!isValidFirstName(firstName)) {
      return;
    }
    if (!isValidLastName(lastName)) {
      return;
    }
    if (!hasSignupContact(email, phone)) {
      return;
    }
    if (phonePartial && emailOk) {
      return;
    }
    if (!passwordMeetsPolicy(password)) {
      return;
    }
    if (password !== confirmPassword) {
      return;
    }

    setPending(true);
    const res = await signUpWithPassword(password, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email,
      phone,
    });
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.needsEmailConfirm) {
      setInfo(
        "Check your email to confirm your account, then you can log in.",
      );
      return;
    }
    if (res.needsPhoneConfirm) {
      setInfo(
        "Finish signing up with the SMS code we sent (Supabase must have SMS / phone sign-up enabled). If you meant to use email only, add a valid email and sign up again.",
      );
      return;
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
          <h1 className="page-title signup-title auth-page-title">Join Us</h1>
          {ready ? (
            <p className="auth-subtitle">
              Create your free account. An admin will approve access to practice banks.
            </p>
          ) : null}
        </header>

        {!ready ? (
          <>
            <p className="muted signup-unconfigured">
              Supabase is not configured. Add environment variables to enable sign
              up.
            </p>
            <div className="auth-cta-stack">
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
            <section
              className="auth-section signup-details-section"
              aria-labelledby="signup-profile-heading"
            >
              <div className="signup-section-head">
                <h2 id="signup-profile-heading" className="auth-section-title">
                  Your details
                </h2>
                <p className="signup-section-legend muted">
                  <RequiredBadge />
                  Required Fields
                </p>
              </div>

              <div className="signup-details-stack">
                <div className="signup-panel">
                  <h3 className="signup-panel-title">Name</h3>
                  <div className="signup-grid signup-grid--2 signup-panel-grid">
                    <div className="field field--signup">
                      <label className="signup-label" htmlFor="signup-first-name">
                        First name <RequiredBadge />
                      </label>
                      <input
                        id="signup-first-name"
                        className={`input input--signup ${attemptedSubmit && !nameOk ? "input--invalid" : ""}`}
                        type="text"
                        name="given-name"
                        autoComplete="given-name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        maxLength={60}
                        aria-required
                        aria-invalid={attemptedSubmit && !nameOk}
                        aria-describedby={
                          attemptedSubmit && !nameOk
                            ? "signup-first-name-hint"
                            : undefined
                        }
                      />
                      {attemptedSubmit && !nameOk ? (
                        <p
                          id="signup-first-name-hint"
                          className="field-hint field-hint--error"
                        >
                          {firstNameHint()}
                        </p>
                      ) : null}
                    </div>
                    <div className="field field--signup">
                      <label className="signup-label" htmlFor="signup-last-name">
                        Last name <RequiredBadge />
                      </label>
                      <input
                        id="signup-last-name"
                        className={`input input--signup ${attemptedSubmit && !lastOk ? "input--invalid" : ""}`}
                        type="text"
                        name="family-name"
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        maxLength={60}
                        aria-required
                        aria-invalid={attemptedSubmit && !lastOk}
                        aria-describedby={
                          attemptedSubmit && !lastOk
                            ? "signup-last-name-hint"
                            : undefined
                        }
                      />
                      {attemptedSubmit && !lastOk ? (
                        <p
                          id="signup-last-name-hint"
                          className="field-hint field-hint--error"
                        >
                          {firstNameHint()}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div
                  className="signup-panel"
                  role="group"
                  aria-labelledby="signup-contact-title"
                >
                  <h3 id="signup-contact-title" className="signup-panel-title">
                    Contact <RequiredBadge />
                  </h3>
                  <p id="signup-contact-legend" className="signup-panel-desc muted">
                    Use a real email and/or mobile number you can access. SMS
                    verification can be wired up later in Supabase.
                  </p>
                  <div className="signup-grid signup-grid--2 signup-panel-grid">
                    <div className="field field--signup">
                      <label className="signup-label" htmlFor="signup-phone">
                        Mobile number <RequiredBadge />
                      </label>
                      <input
                        id="signup-phone"
                        className={`input input--signup ${contactInvalidVisual && (phonePartial || (!emailOk && digits)) ? "input--invalid" : ""}`}
                        type="tel"
                        name="phone"
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        inputMode="tel"
                        aria-required
                        aria-invalid={Boolean(
                          contactInvalidVisual && (phonePartial || !contactOk),
                        )}
                        aria-describedby={[
                          "signup-contact-legend",
                          attemptedSubmit &&
                          (!contactOk ||
                            (phonePartial && emailOk) ||
                            (emailPartial && !phoneOk))
                            ? "signup-contact-hint"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      />
                    </div>
                    <div className="field field--signup">
                      <label className="signup-label" htmlFor="signup-email">
                        Email <RequiredBadge />
                      </label>
                      <input
                        id="signup-email"
                        className={`input input--signup ${contactInvalidVisual && (emailPartial || (!phoneOk && emailTrim)) ? "input--invalid" : ""}`}
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        aria-required
                        aria-invalid={Boolean(
                          contactInvalidVisual && (emailPartial || !contactOk),
                        )}
                        aria-describedby={[
                          "signup-contact-legend",
                          attemptedSubmit &&
                          (!contactOk ||
                            (phonePartial && emailOk) ||
                            (emailPartial && !phoneOk))
                            ? "signup-contact-hint"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      />
                    </div>
                  </div>
                  {attemptedSubmit &&
                  (!contactOk ||
                    (phonePartial && emailOk) ||
                    (emailPartial && !phoneOk)) ? (
                    <p
                      id="signup-contact-hint"
                      className="field-hint field-hint--error signup-contact-hint"
                    >
                      {!contactOk
                        ? contactFieldsHint()
                        : phonePartial && emailOk
                          ? "Clear the mobile field or enter a complete phone number (10–15 digits)."
                          : "Enter a valid email address, or clear the email field and use your mobile number instead."}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="auth-section" aria-labelledby="signup-security-heading">
              <h2 id="signup-security-heading" className="auth-section-title">
                Password
              </h2>
              <div className="field field--signup">
                <label className="signup-label" htmlFor="signup-password">
                  Create password <RequiredBadge />
                </label>
                <div className="input-with-toggle">
                  <input
                    id="signup-password"
                    className={`input input--toggle ${attemptedSubmit && !pwdOk ? "input--invalid" : ""}`}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-required
                    aria-invalid={attemptedSubmit && !pwdOk}
                    aria-describedby={[
                      "signup-password-meter",
                      attemptedSubmit && !pwdOk ? "signup-password-hint" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                  />
                  <button
                    type="button"
                    className="input-toggle-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <div
                  id="signup-password-meter"
                  className={`password-meter ${pwdMeterClass}`}
                  role="progressbar"
                  aria-valuenow={pwdPassed}
                  aria-valuemin={0}
                  aria-valuemax={pwdChecks.length}
                  aria-valuetext={
                    password.length === 0
                      ? "No password entered"
                      : `${pwdStrengthLabel} (${pwdMeterPct}%)`
                  }
                  aria-label="Password strength"
                >
                  <div className="password-meter-head">
                    <span className="password-meter-caption">Strength</span>
                    {pwdStrengthLabel ? (
                      <span className="password-meter-value">{pwdStrengthLabel}</span>
                    ) : (
                      <span className="password-meter-value password-meter-value--placeholder">
                        —
                      </span>
                    )}
                  </div>
                  <div className="password-meter-track" aria-hidden>
                    <div
                      className="password-meter-fill"
                      style={{ width: `${pwdMeterPct}%` }}
                    />
                  </div>
                </div>
                {attemptedSubmit && !pwdOk ? (
                  <p id="signup-password-hint" className="field-hint field-hint--error">
                    {PASSWORD_POLICY_ERROR}
                  </p>
                ) : null}
              </div>

              <div className="field field--signup">
                <label className="signup-label" htmlFor="signup-password-confirm">
                  Confirm password <RequiredBadge />
                </label>
                <div className="input-with-toggle">
                  <input
                    id="signup-password-confirm"
                    className={`input input--toggle ${confirmMismatch || (attemptedSubmit && confirmPassword.length === 0) ? "input--invalid" : ""}`}
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    aria-required
                    aria-invalid={
                      Boolean(confirmMismatch) ||
                      (attemptedSubmit && confirmPassword.length === 0)
                    }
                    aria-describedby={
                      attemptedSubmit &&
                      (confirmMismatch ||
                        (confirmPassword.length === 0 && password.length > 0))
                        ? "signup-confirm-hint"
                        : undefined
                    }
                  />
                  <button
                    type="button"
                    className="input-toggle-btn"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-pressed={showConfirm}
                  >
                    {showConfirm ? "Hide" : "Show"}
                  </button>
                </div>
                {attemptedSubmit &&
                (confirmMismatch ||
                  (confirmPassword.length === 0 && password.length > 0)) ? (
                  <p id="signup-confirm-hint" className="field-hint field-hint--error" role="alert">
                    {confirmMismatch
                      ? "Passwords must match."
                      : "Confirm your password."}
                  </p>
                ) : null}
              </div>
            </section>

            {error ? <p className="auth-error">{error}</p> : null}
            {info ? <p className="auth-info">{info}</p> : null}

            <div className="auth-cta-stack">
              <button
                type="submit"
                className="btn btn-signup-primary"
                disabled={pending}
              >
                {pending ? "Joining…" : "Join For Free"}
              </button>
              <Link
                to="/auth/login"
                className="btn btn-welcome-secondary auth-cta-secondary"
              >
                Log in
              </Link>
            </div>
          </form>
        )}
        <footer className="auth-footer">
          <Link to="/" className="auth-footer-link">
            ← Back to home
          </Link>
        </footer>
      </div>
    </div>
  );
}
