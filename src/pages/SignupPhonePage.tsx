import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import {
  isValidFirstName,
  isValidLastName,
  isValidPhoneDigits,
  passwordStrength,
  phoneDigits,
  toE164Loose,
} from "../lib/signupValidation";
import { StudyDeckBrand } from "../components/StudyDeckLogo";
import { useAuth } from "../context/AuthContext";
import {
  RequiredBadge,
  SignupNameFields,
  SignupPasswordFields,
  signupPasswordValid,
} from "../components/signup/SignupFormSections";

function plainPhoneAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("phone") &&
    (lower.includes("disabled") ||
      lower.includes("not enabled") ||
      lower.includes("provider"))
  ) {
    return "Phone sign-up is not turned on for this site. Please create an account with email instead.";
  }
  return message;
}

export default function SignupPhonePage() {
  const navigate = useNavigate();
  const { user, loading, signedInHomePath, signUpWithPassword } = useAuth();
  const [step, setStep] = useState<"details" | "code">("details");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [attemptedVerify, setAttemptedVerify] = useState(false);
  const ready = isSupabaseConfigured();

  const digits = useMemo(() => phoneDigits(phone), [phone]);
  const phoneOk = isValidPhoneDigits(digits);
  const phonePartial = digits.length > 0 && !phoneOk;

  useEffect(() => {
    if (loading || !user) return;
    navigate(signedInHomePath, { replace: true });
  }, [loading, user, signedInHomePath, navigate]);

  async function onSubmitDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setAttemptedSubmit(true);
    if (!ready) return;

    if (!isValidFirstName(firstName) || !isValidLastName(lastName)) return;
    if (!phoneOk) return;
    if (!signupPasswordValid(password, confirmPassword, true)) return;
    if (!passwordStrength(password).acceptable) return;
    if (password !== confirmPassword) return;

    const e164 = toE164Loose(digits);
    if (!e164) return;

    setPending(true);
    const res = await signUpWithPassword(password, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: "",
      phone,
    });
    setPending(false);
    if (res.error) {
      setError(plainPhoneAuthError(res.error));
      return;
    }
    if (res.needsPhoneConfirm) {
      setPhoneE164(e164);
      setStep("code");
      setInfo("Enter the code we texted to your phone to finish creating your account.");
      setOtp("");
      setAttemptedVerify(false);
      return;
    }
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAttemptedVerify(true);
    if (!supabase || !phoneE164) return;

    const token = otp.replace(/\D/g, "");
    if (token.length < 4) {
      setError("Enter the code from your text message.");
      return;
    }

    setPending(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token,
      type: "sms",
    });
    setPending(false);
    if (verifyError) {
      setError(plainPhoneAuthError(verifyError.message));
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
          <h1 className="page-title signup-title auth-page-title">Create account</h1>
          {ready ? (
            <p className="auth-subtitle">
              {step === "code"
                ? "Almost done—confirm your mobile number."
                : "Sign up with your mobile number. An admin approves your account before you can start a session."}
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
        ) : step === "code" ? (
          <form onSubmit={onVerifyCode} className="auth-form signup-form" noValidate>
            <section className="auth-section" aria-labelledby="signup-phone-code-heading">
              <h2 id="signup-phone-code-heading" className="auth-section-title">
                Verification code
              </h2>
              <p className="muted signup-panel-desc">
                We sent a text to{" "}
                <span className="signup-phone-display">{phoneE164 ?? "your phone"}</span>.
                Enter the code below.
              </p>
              <div className="field field--signup">
                <label className="signup-label" htmlFor="signup-phone-otp">
                  Code <RequiredBadge />
                </label>
                <input
                  id="signup-phone-otp"
                  className={`input input--signup ${attemptedVerify && otp.replace(/\D/g, "").length < 4 ? "input--invalid" : ""}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  aria-required
                  aria-invalid={attemptedVerify && otp.replace(/\D/g, "").length < 4}
                />
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
                {pending ? "Verifying…" : "Verify and continue"}
              </button>
              <button
                type="button"
                className="btn btn-welcome-secondary auth-cta-secondary"
                disabled={pending}
                onClick={() => {
                  setStep("details");
                  setError(null);
                  setInfo(null);
                  setOtp("");
                }}
              >
                Back to your details
              </button>
              <Link
                to="/auth/login"
                className="btn btn-welcome-secondary auth-cta-secondary"
              >
                Log in
              </Link>
            </div>
          </form>
        ) : (
          <form onSubmit={onSubmitDetails} className="auth-form signup-form" noValidate>
            <section className="signup-details-section" aria-label="Your details">
              <div className="signup-details-stack">
                <SignupNameFields
                  idPrefix="signup-phone"
                  firstName={firstName}
                  lastName={lastName}
                  onFirstNameChange={setFirstName}
                  onLastNameChange={setLastName}
                  attemptedSubmit={attemptedSubmit}
                />

                <div className="signup-panel">
                  <div className="field field--signup">
                    <label className="signup-label" htmlFor="signup-phone-number">
                      Mobile number <RequiredBadge />
                    </label>
                    <input
                      id="signup-phone-number"
                      className={`input input--signup ${attemptedSubmit && !phoneOk ? "input--invalid" : ""}`}
                      type="tel"
                      name="phone"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      aria-required
                      aria-invalid={attemptedSubmit && !phoneOk}
                      aria-describedby={
                        attemptedSubmit && !phoneOk
                          ? "signup-phone-number-hint"
                          : undefined
                      }
                    />
                    {attemptedSubmit && !phoneOk ? (
                      <p
                        id="signup-phone-number-hint"
                        className="field-hint field-hint--error"
                      >
                        {phonePartial
                          ? "Enter the full number (10–15 digits)."
                          : "Enter your mobile number (10–15 digits)."}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <SignupPasswordFields
              idPrefix="signup-phone"
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
