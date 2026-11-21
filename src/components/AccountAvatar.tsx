import { useEffect, useState } from "react";

interface AccountAvatarProps {
  src?: string | null;
  name: string;
  className: string;
  fallbackClassName?: string;
  fallbackText?: string;
}

/**
 * Renders account photos consistently and never leaves a broken-image glyph
 * in the UI. The initials fallback is automatically restored when the URL
 * changes or the browser cannot decode/load the remote image.
 */
export function AccountAvatar({
  src,
  name,
  className,
  fallbackClassName = className,
  fallbackText,
}: AccountAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [src]);

  const normalizedSrc = typeof src === "string" ? src.trim() : "";
  const label = name.trim() ? "Аватар " + name.trim() : "Аватар игрока";
  const initial = fallbackText ?? (name.trim().slice(0, 1).toUpperCase() || "?");

  if (normalizedSrc && !imageFailed) {
    return (
      <img
        className={className}
        // Cross-origin isolation (required for threaded Stockfish) blocks
        // no-CORS images from Supabase Storage under COEP: require-corp.
        // Request the public avatar in CORS mode so the browser can display it.
        crossOrigin={/^https?:\\/\\//i.test(normalizedSrc) ? "anonymous" : undefined}
        src={normalizedSrc}
        alt={label}
        loading="eager"
        decoding="async"
        draggable={false}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span className={fallbackClassName} role="img" aria-label={label}>
      {initial}
    </span>
  );
}
