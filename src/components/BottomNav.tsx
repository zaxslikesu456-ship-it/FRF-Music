import React from 'react';
import { Home, Search, LibraryBig, Settings } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import type { NavTab } from '../types/music';

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab } = useAudio();

  const navItems: { id: NavTab; label: string; icon: React.ElementType }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'library', label: 'Library', icon: LibraryBig },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="w-full bg-app-primary px-2 pb-3 pt-2 flex items-start justify-around z-20">
      {navItems.map(item => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className="flex flex-col items-center gap-1.5 shrink-0"
          >
            <span
              className={`px-7 py-2 rounded-full transition-all duration-200 ${
                isActive ? 'bg-app-card' : ''
              }`}
            >
              <Icon className={`w-6 h-6 ${isActive ? 'text-app-primary' : 'text-app-primary'}`} />
            </span>
            <span className="text-sm font-semibold text-app-primary">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};
