/** First line of a sent message, shortened to a list title. */
export function titleOf(text: string, limit = 24): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") {
    return "新对话";
  }
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}