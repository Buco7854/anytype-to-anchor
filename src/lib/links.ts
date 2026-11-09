/** Only navigation protocols that are safe to expose as preview/Anchor links. */
export function safeExternalLink(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const text = value.trim();
  try {
    const url = new URL(text);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return text;
  } catch {
    /* Invalid destinations remain readable text. */
  }
}
