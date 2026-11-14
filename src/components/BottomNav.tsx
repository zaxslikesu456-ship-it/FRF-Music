import React from 'react';
import { t as tr } from '../i18n';
import { Home, Search, LibraryBig, Settings } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import type { NavTab } from '../types/music';

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab, closeArtistProfile } = useAudio();

  const navItems: { id: NavTab; label: string; icon: React.ElementType }[] = [
    { id: 'home', label: tr("Home"), icon: Home },
    { id: 'search', label: tr("Search"), icon: Search },
    { id: 'library', label: tr("Library"), icon: LibraryBig },
    { id: 'settings', label: tr("Settings"), icon: Settings },
  ];

  return (
    <div className="w-full bg-app-primary px-2 safe-bottom pt-2 flex items-start justify-around z-20">
      {navItems.map(item => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => {
              closeArtistProfile();
              setActiveTab(item.id);
            }}
            className="flex flex-col items-center gap-1.5 shrink-0 active:scale-95 transition-transform"
          >
            <span
              className={`px-7 py-2 rounded-full transition-all duration-300 ${
                isActive ? 'bg-app-card scale-100 shadow-sm' : 'scale-95 bg-transparent'
              }`}
            >
              <Icon
                key={isActive ? `${item.id}-active` : item.id}
                className={`w-6 h-6 transition-colors duration-200 ${
                  isActive ? 'text-app-accent anim-nav-pop' : 'text-app-primary'
                }`}
              />
            </span>
            <span className={`text-sm font-semibold transition-colors duration-200 ${isActive ? 'text-app-accent' : 'text-app-primary'}`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};
