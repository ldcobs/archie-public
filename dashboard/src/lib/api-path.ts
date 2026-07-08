/**
 * Prefix all client-side API fetch calls with the Next.js basePath.
 * Set NEXT_PUBLIC_BASE_PATH at build time (e.g. /v2).
 * Defaults to '' so production with no basePath works unchanged.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const SECURITY_PAGE_PATH = process.env.NEXT_PUBLIC_SECURITY_PAGE_PATH ?? '/security';

export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}

export function securityPageUrl(): string {
  return apiUrl(SECURITY_PAGE_PATH);
}
