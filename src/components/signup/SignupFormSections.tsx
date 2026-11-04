import { useMemo, useState } from "react";
import {
  firstNameHint,
  getPasswordChecks,
  isValidFirstName,
  isValidLastName,
  passwordStrength,
} from "../../lib/signupValidation";

export const PASSWORD_POLICY_ERROR =
  "Use a moderate password or stronger: at least 8 characters, with a mix of letters, numbers, or symbols.";

export function RequiredBadge() {
  return (
    <abbr className="field-required" title="Required" aria-label="required">
      *
    </abbr>
  );
}

type NameFieldsProps = {
  idPrefix: string;
  firstName: string;
  lastName: string;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  attemptedSubmit: boolean;
};

export function SignupNameFields({
  idPrefix,
  firstName,
  lastName,
  onFirstNameChange,
  onLastNameChange,
  attemptedSubmit,
}: NameFieldsProps) {
  const nameOk = isValidFirstName(firstName);
  const lastOk = isValidLastName(lastName);

  return (
    <div className="signup-panel">
      <div className="signup-grid signup-grid--2 signup-panel-grid">
        <div className="field field--signup">
          <label className="signup-label" htmlFor={`${idPrefix}-first-name`}>
            First name <RequiredBadge />
          </label>
          <input
            id={`${idPrefix}-first-name`}
            className={`input input--signup ${attemptedSubmit && !nameOk ? "input--invalid" : ""}`}
            type="text"
            name="given-name"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => onFirstNameChange(e.target.value)}
            maxLength={60}
            aria-required
            aria-invalid={attemptedSubmit && !nameOk}
            aria-describedby={
              attemptedSubmit && !nameOk ? `${idPrefix}-first-name-hint` : undefined
            }
          />
          {attemptedSubmit && !nameOk ? (
            <p
              id={`${idPrefix}-first-name-hint`}
              className="field-hint field-hint--error"
            >
              {firstNameHint()}
            </p>
          ) : null}
        </div>
        <div className="field field--signup">
          <label className="signup-label" htmlFor={`${idPrefix}-last-name`}>
            Last name <RequiredBadge />
          </label>
          <input
            id={`${idPrefix}-last-name`}
            className={`input input--signup ${attemptedSubmit && !lastOk ? "input--invalid" : ""}`}
            type="text"
            name="family-name"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => onLastNameChange(e.target.value)}
            maxLength={60}
            aria-required
            aria-invalid={attemptedSubmit && !lastOk}
            aria-describedby={
              attemptedSubmit && !lastOk ? `${idPrefix}-last-name-hint` : undefined
            }
          />
          {attemptedSubmit && !lastOk ? (
            <p
              id={`${idPrefix}-last-name-hint`}
              className="field-hint field-hint--error"
            >
              {firstNameHint()}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type PasswordFieldsProps = {
  idPrefix: string;
  password: string;
  confirmPassword: string;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  attemptedSubmit: boolean;
};

export function SignupPasswordFields({
  idPrefix,
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  attemptedSubmit,
}: PasswordFieldsProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const strength = useMemo(() => passwordStrength(password), [password]);
  const pwdOk = strength.acceptable;
  const pwdPassed = strength.score;
  const pwdMeterClass = strength.meterClass;
  const pwdStrengthLabel = strength.label;
  const pwdMeterPct =
    strength.total > 0 ? Math.round((strength.score / strength.total) * 100) : 0;
  const confirmMismatch =
    attemptedSubmit &&
    confirmPassword.length > 0 &&
    confirmPassword !== password;

  return (
    <section className="auth-section" aria-label="Password">
      <div className="field field--signup">
        <label className="signup-label" htmlFor={`${idPrefix}-password`}>
          Create password <RequiredBadge />
        </label>
        <div className="input-with-toggle">
          <input
            id={`${idPrefix}-password`}
            className={`input input--toggle ${attemptedSubmit && !pwdOk ? "input--invalid" : ""}`}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            aria-required
            aria-invalid={attemptedSubmit && !pwdOk}
            aria-describedby={
              [
                `${idPrefix}-password-meter`,
                attemptedSubmit && !pwdOk ? `${idPrefix}-password-hint` : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
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
          id={`${idPrefix}-password-meter`}
          className={`password-meter ${pwdMeterClass}`}
          role="progressbar"
          aria-valuenow={pwdPassed}
          aria-valuemin={0}
          aria-valuemax={strength.total}
          aria-valuetext={
            password.length === 0
              ? "No password entered"
              : `${pwdStrengthLabel} (${pwdMeterPct}%)`
          }
          aria-label="Password strength"
        >
          <div className="password-meter-row">
            <div className="password-meter-track" aria-hidden>
              <div
                className="password-meter-fill"
                style={{ width: `${pwdMeterPct}%` }}
              />
            </div>
            <span className="password-meter-value">
              {pwdStrengthLabel || "Strength"}
            </span>
          </div>
        </div>
        {password.length > 0 ? (
          <ul className="pwd-checks" aria-label="Ways to strengthen your password">
            {getPasswordChecks(password).map((check) => (
              <li key={check.id} className={check.pass ? "is-met" : undefined}>
                {check.label}
              </li>
            ))}
          </ul>
        ) : null}
        {attemptedSubmit && !pwdOk ? (
          <p id={`${idPrefix}-password-hint`} className="field-hint field-hint--error">
            {PASSWORD_POLICY_ERROR}
          </p>
        ) : null}
      </div>

      <div className="field field--signup">
        <label className="signup-label" htmlFor={`${idPrefix}-password-confirm`}>
          Confirm password <RequiredBadge />
        </label>
        <div className="input-with-toggle">
          <input
            id={`${idPrefix}-password-confirm`}
            className={`input input--toggle ${confirmMismatch || (attemptedSubmit && confirmPassword.length === 0) ? "input--invalid" : ""}`}
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            aria-required
            aria-invalid={
              Boolean(confirmMismatch) ||
              (attemptedSubmit && confirmPassword.length === 0)
            }
            aria-describedby={
              attemptedSubmit &&
              (confirmMismatch ||
                (confirmPassword.length === 0 && password.length > 0))
                ? `${idPrefix}-confirm-hint`
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
          <p
            id={`${idPrefix}-confirm-hint`}
            className="field-hint field-hint--error"
            role="alert"
          >
            {confirmMismatch ? "Passwords must match." : "Confirm your password."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function signupPasswordValid(
  password: string,
  confirmPassword: string,
  attemptedSubmit: boolean,
): boolean {
  if (!passwordStrength(password).acceptable) return false;
  if (password !== confirmPassword) return false;
  if (attemptedSubmit && confirmPassword.length === 0) return false;
  return true;
}
