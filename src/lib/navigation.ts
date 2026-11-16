"use client";

/**
 * Full page load. Used after switching workspace / joining or leaving one so that every view
 * (and every cached client-side list) is re-fetched in the new workspace context.
 */
export function hardNavigate(url: string) {
  window.location.assign(url);
}
