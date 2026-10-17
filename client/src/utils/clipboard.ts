/**
 * Copy text to the clipboard. `navigator.clipboard` only exists in secure
 * contexts, so on a plain-HTTP self-hosted origin it is undefined and a direct
 * call throws a TypeError; fall back to the legacy execCommand path there.
 * Resolves true on success, false when nothing worked (never throws).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // permission denied etc. — try the fallback below
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
