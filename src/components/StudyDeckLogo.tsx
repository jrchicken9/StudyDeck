type Props = {
  className?: string;
  title?: string;
  width?: number | string;
};

export function StudyDeckBrand({
  layout = "inline",
  logoClassName,
  wordmarkClassName: _wordmarkClassName,
}: {
  layout?: "inline" | "stack";
  logoClassName: string;
  wordmarkClassName?: string;
}) {
  const root =
    layout === "stack"
      ? "studydeck-brand studydeck-brand--stack"
      : "studydeck-brand studydeck-brand--inline";
  return (
    <div className={root}>
      <StudyDeckLogo className={logoClassName} />
    </div>
  );
}

export function StudyDeckLogo({ className = "", title = "StudyDeck", width }: Props) {
  return (
    <img
      src="/branding/studydeck-logo-main-cropped.png"
      alt={title}
      width={width}
      className={className}
      style={{ height: "auto", maxWidth: "100%" }}
    />
  );
}
