/**
 * Копирование текста с fallback для браузеров без Clipboard API или без разрешения.
 * Вызывается только из действия пользователя (клик по кнопке).
 */
export async function copyText(text: string): Promise<boolean> {
  let field: HTMLTextAreaElement | null = null;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Пробуем совместимый fallback ниже.
      }
    }

    if (typeof document === "undefined") return false;
    field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.opacity = "0";
    field.style.pointerEvents = "none";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field?.remove();
  }
}
