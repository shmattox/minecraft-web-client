/** PlaceSchema (PLACE-1012): the ticket URL to move this tab to, or undefined unless it is https on an allowlisted origin. */
export const placeschemaPortalTarget = (url: unknown, allowed: readonly string[] | undefined): string | undefined => {
  if (typeof url !== 'string') return undefined
  let u: URL
  try { u = new URL(url) } catch { return undefined }
  if (u.protocol !== 'https:' || u.username || u.password) return undefined
  return (allowed ?? []).includes(u.origin) ? u.href : undefined
}
