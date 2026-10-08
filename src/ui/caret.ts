/** Inserts a placeholder at the textarea's caret (with a leading space when needed). */
export function insertAtCaret(
  el: HTMLTextAreaElement | null,
  value: string,
  token: string,
  max: number,
): { next: string; caret: number } | null {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,!?;:)]/.test(after) ? ' ' : '';
  const insert = `${lead}${token}${trail}`;
  const next = before + insert + after;
  if (next.length > max) return null;
  return { next, caret: before.length + insert.length };
}
