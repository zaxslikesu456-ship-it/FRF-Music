import React, { useState, useEffect } from 'react';
import { Wifi, Battery, Signal } from 'lucide-react';

export const AndroidHeader: React.FC = () => {
  const [time, setTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    updateTime();
    const timer = setInterval(updateTime, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="w-full bg-black text-white px-5 py-2.5 flex items-center justify-between text-xs tracking-wider select-none border-b border-neutral-900/60 z-30 font-mono">
      <div className="font-semibold text-neutral-200 flex items-center gap-1.5">
        <span>{time || '12:00'}</span>
      </div>
      <div className="flex items-center gap-3 text-neutral-400">
        <Signal className="w-3.5 h-3.5" />
        <Wifi className="w-3.5 h-3.5" />
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono">98%</span>
          <Battery className="w-4 h-4 text-white fill-white" />
        </div>
      </div>
    </div>
  );
};
