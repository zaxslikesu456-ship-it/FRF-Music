import React from 'react';
import { BottomNav } from './BottomNav';
import { MiniPlayer } from './MiniPlayer';
import { HomeView } from './HomeView';
import { LibraryView } from './LibraryView';
import { SearchView } from './SearchView';
import { SettingsView } from './SettingsView';
import { NowPlayingScreen } from './NowPlayingScreen';
import { ArtistDetailView } from './ArtistDetailView';
import { AnimatedBackground } from './AnimatedBackground';
import { useAudio } from '../context/AudioContext';

export const AndroidFrame: React.FC = () => {
  const { activeTab, settings, downloadStatus, artistProfileName, closeArtistProfile } = useAudio();

  const getFontClass = () => {
    if (settings.fontStyle === 'mono') return 'font-mono';
    if (settings.fontStyle === 'serif') return 'font-serif';
    return 'font-sans';
  };

  return (
    <div className={`w-full h-screen flex flex-col relative overflow-hidden select-none bg-app-primary text-app-primary transition-colors duration-500 ${getFontClass()}`}>
      <AnimatedBackground type={settings.backgroundAnimation || 'off'} />
      {settings.backgroundImage && (
        <img
          src={settings.backgroundImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
      )}
      {/* YouTube IFrame Container: must stay rendered with non-zero size or Android WebView refuses to play audio */}
      <div
        id="yt-hidden-player"
        aria-hidden="true"
        className="fixed bottom-0 left-0 w-px h-px opacity-0 pointer-events-none overflow-hidden"
      />

      {/* App Workspace Views */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div key={activeTab} className="flex-1 flex flex-col overflow-hidden anim-fade">
          {activeTab === 'home' && <HomeView />}
          {activeTab === 'search' && <SearchView />}
          {activeTab === 'library' && <LibraryView />}
          {activeTab === 'settings' && <SettingsView />}
        </div>
      </main>

      {/* Mini Player */}
      <MiniPlayer />

      {/* Download Progress Toast */}
      {downloadStatus && (
        <div className="fixed bottom-36 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary text-xs font-mono font-bold shadow-2xl max-w-[90%] text-center">
          {downloadStatus}
        </div>
      )}

      {/* Bottom Navigation */}
      <BottomNav />

      {/* Artist Profile Overlay */}
      {artistProfileName && (
        <div className="fixed inset-0 z-40 bg-app-primary flex flex-col anim-fade">
          <ArtistDetailView
            artistName={artistProfileName}
            localTracks={[]}
            onBack={closeArtistProfile}
          />
        </div>
      )}

      {/* Full Screen Player Modal */}
      <NowPlayingScreen />
    </div>
  );
};
