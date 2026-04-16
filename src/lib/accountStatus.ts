export const ACCOUNT_STATUSES = [
  "active",
  "suspended",
  "restricted",
  "banned",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function parseAccountStatus(raw: unknown): AccountStatus {
  if (typeof raw === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(raw)) {
    return raw as AccountStatus;
  }
  return "active";
}

/** Exam banks / quiz routes — only fully active accounts. */
export function canAccessExams(approvedAt: string | null | undefined, status: AccountStatus): boolean {
  return Boolean(approvedAt) && status === "active";
}

/** Banned users are limited to the moderation screen + sign out. */
export function isBannedStatus(status: AccountStatus): boolean {
  return status === "banned";
}

export function accountStatusLabel(status: AccountStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "suspended":
      return "Suspended";
    case "restricted":
      return "Restricted";
    case "banned":
      return "Banned";
    default:
      return status;
  }
}

export function accountStatusDescription(status: AccountStatus): string {
  switch (status) {
    case "active":
      return "Full access per approval rules.";
    case "suspended":
      return "Access is paused. You can still open Profile; practice banks are blocked.";
    case "restricted":
      return "Practice banks are blocked; other areas may still be available.";
    case "banned":
      return "This account is blocked. Sign out or contact support.";
    default:
      return "";
  }
}
