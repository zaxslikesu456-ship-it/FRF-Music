import { useEffect, useState } from 'react';
import { AudioProvider } from './context/AudioContext';
import { AndroidFrame } from './components/AndroidFrame';
import { DesktopFrame } from './components/DesktopFrame';
import { AlarmHost } from './components/AlarmHost';
import { WelcomeScreen, shouldShowWelcome } from './components/WelcomeScreen';
import { useI18n } from './i18n';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia('(min-width: 1024px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export function App() {
  const isDesktop = useIsDesktop();
  // Re-renders the whole app (without remounting it, so playback carries on)
  // when the language changes; every screen reads its text through t().
  useI18n();
  const [showWelcome, setShowWelcome] = useState(shouldShowWelcome);
  return (
    <AudioProvider>
      <AlarmHost />
      {isDesktop ? <DesktopFrame /> : <AndroidFrame />}
      {showWelcome && <WelcomeScreen onDone={() => setShowWelcome(false)} />}
    </AudioProvider>
  );
}

export default App;
