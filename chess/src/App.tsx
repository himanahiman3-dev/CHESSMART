import { useIsMobile } from "./lib/device";
import { useReviewApp } from "./hooks/useReviewApp";
import { DesktopLayout, MobileLayout } from "./components/Layouts";

export default function App() {
  const isMobile = useIsMobile();
  const app = useReviewApp(isMobile);
  return isMobile ? <MobileLayout app={app} /> : <DesktopLayout app={app} />;
}
