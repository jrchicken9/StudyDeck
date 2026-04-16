export type PublicationAudience = "everyone" | "friends";
export type PublicationPricing = "free" | "paid";

export function parsePublicationAudience(raw: unknown): PublicationAudience {
  return raw === "friends" ? "friends" : "everyone";
}

export function parsePublicationPricing(raw: unknown): PublicationPricing {
  return raw === "paid" ? "paid" : "free";
}

export function audienceShortLabel(a: PublicationAudience): string {
  return a === "friends" ? "Friends only" : "Everyone";
}

export function pricingShortLabel(p: PublicationPricing): string {
  return p === "paid" ? "Paid" : "Free";
}
