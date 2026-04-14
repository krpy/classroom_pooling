/**
 * Reads ADMIN_UI_PASSWORD on each call so Railway / process env updates apply
 * after deploy without relying on a stale module-level snapshot.
 */
export function getAdminUiPassword() {
  const raw = process.env.ADMIN_UI_PASSWORD;
  if (raw == null) return "";
  return String(raw).trim().replace(/^\uFEFF/, "");
}
