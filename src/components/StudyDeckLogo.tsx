import { useId } from "react";

type Props = {
  className?: string;
  /** Accessible label */
  title?: string;
};

/**
 * StudyDeck mark: stacked study cards, violet–indigo top card, cyan accent.
 * Custom mark (not a stock icon); pair with the wordmark in the nav.
 */
export function StudyDeckLogo({ className, title = "StudyDeck" }: Props) {
  const uid = useId().replace(/:/g, "");
  const gradId = `sd-fill-${uid}`;

  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        <linearGradient
          id={gradId}
          x1="6"
          y1="4"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#8b5cf6" />
          <stop offset="0.45" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect
        x="3"
        y="14"
        width="22"
        height="16"
        rx="3"
        fill="#27272a"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="1"
      />
      <rect
        x="5"
        y="10"
        width="22"
        height="18"
        rx="3.5"
        fill="#3f3f46"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="1"
      />
      <rect
        x="6"
        y="4"
        width="22"
        height="24"
        rx="4.5"
        fill={`url(#${gradId})`}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1"
      />
      <path
        d="M10 12h14M10 16h11M10 20h9"
        stroke="rgba(255,255,255,0.38)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="25" cy="7" r="2.25" fill="#22d3ee" opacity="0.95" />
    </svg>
  );
}
