/**
 * `navigator.clipboard` only exists in a secure context (HTTPS or localhost).
 * A Docker deployment is usually reached over plain HTTP on a LAN IP or
 * hostname, where the Clipboard API is undefined and every "copy" button fails
 * silently. Fall back to the legacy `execCommand` path there.
 */
export async function copyText(value: string): Promise<boolean> {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or an insecure origin — try the legacy path below.
    }
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
