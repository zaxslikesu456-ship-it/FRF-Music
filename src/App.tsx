import { useEffect, useState } from 'react';
import { AudioProvider } from './context/AudioContext';
import { AndroidFrame } from './components/AndroidFrame';
import { DesktopFrame } from './components/DesktopFrame';

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
  return <AudioProvider>{isDesktop ? <DesktopFrame /> : <AndroidFrame />}</AudioProvider>;
}

export default App;
