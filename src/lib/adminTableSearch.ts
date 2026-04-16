export type AdminProfileSearchRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  moderation_note?: string | null;
};

/** Case-insensitive match on name, email, id, or moderation note (all tokens must match). */
export function profileMatchesAdminSearch(
  row: AdminProfileSearchRow,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim().toLowerCase();
  const email = (row.email ?? "").toLowerCase();
  const id = row.id.toLowerCase();
  const idCompact = id.replace(/-/g, "");
  const note = (row.moderation_note ?? "").toLowerCase();
  const haystack = `${name} ${email} ${id} ${idCompact} ${note}`;
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t));
}
