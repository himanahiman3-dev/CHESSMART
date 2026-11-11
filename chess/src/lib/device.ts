import { useEffect, useState } from "react";

/** Определяем устройство один раз при входе на сайт (UA + сенсорный экран). */
function detectPhoneByUA(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile) return true;
  if (/Android|iPhone|iPod|Windows Phone|IEMobile|Opera Mini|Mobile|BlackBerry/i.test(ua)) return true;
  // iPadOS притворяется Mac
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  if (/iPad|Tablet/i.test(ua)) return true;
  return false;
}

const initialUA = detectPhoneByUA();

export function useIsMobile(): boolean {
  const [narrow, setNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < 820 : false
  );
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 820);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const mobile = initialUA || narrow;
  useEffect(() => {
    document.documentElement.dataset.device = mobile ? "mobile" : "desktop";
  }, [mobile]);
  return mobile;
}
