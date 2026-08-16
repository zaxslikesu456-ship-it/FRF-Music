import React from 'react';

export const AndroidNavBar: React.FC = () => {
  return (
    <div className="w-full bg-app-primary py-2.5 flex items-center justify-center select-none border-t border-app-theme z-30">
      <div className="w-32 h-1 bg-neutral-600 rounded-full hover:bg-app-highlight transition-colors cursor-pointer" />
    </div>
  );
};
