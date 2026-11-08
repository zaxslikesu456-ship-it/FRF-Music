import React, { useCallback, useRef, useState } from 'react';

// PC window layout: how wide the sidebar and the player panel are, and
// whether each is shown. Remembered between sessions.

export interface PcLayout {
  sidebarWidth: number;
  sidebarOpen: boolean;
  playerWidth: number;
  playerOpen: boolean;
}

export const SIDEBAR = { min: 180, max: 380, default: 224, collapseBelow: 130 };
export const PLAYER = { min: 260, max: 560, default: 320, collapseBelow: 200 };

const KEY = 'frf_pc_layout_v1';
const DEFAULTS: PcLayout = {
  sidebarWidth: SIDEBAR.default,
  sidebarOpen: true,
  playerWidth: PLAYER.default,
  playerOpen: true,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function usePcLayout() {
  const [layout, setLayout] = useState<PcLayout>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!saved) return DEFAULTS;
      return {
        sidebarWidth: clamp(Number(saved.sidebarWidth) || SIDEBAR.default, SIDEBAR.min, SIDEBAR.max),
        sidebarOpen: saved.sidebarOpen !== false,
        playerWidth: clamp(Number(saved.playerWidth) || PLAYER.default, PLAYER.min, PLAYER.max),
        playerOpen: saved.playerOpen !== false,
      };
    } catch {
      return DEFAULTS;
    }
  });
  const update = useCallback((patch: Partial<PcLayout>) => {
    setLayout(prev => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // still applies for this session
      }
      return next;
    });
  }, []);
  return { layout, update };
}

/**
 * A drag handle on a panel's inner edge. Drag to resize; drag it almost shut to
 * hide the panel; double-click to reset its width.
 */
export const ResizeHandle: React.FC<{
  edge: 'left' | 'right';
  width: number;
  limits: { min: number; max: number; default: number; collapseBelow: number };
  onResize: (width: number) => void;
  onCollapse: () => void;
  label: string;
}> = ({ edge, width, limits, onResize, onCollapse, label }) => {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    setDragging(true);
    // The YouTube video iframe would swallow the pointer while dragging over it.
    document.body.classList.add('pc-resizing');
  };
  const raw = (e: React.PointerEvent) => {
    const s = start.current!;
    const dx = e.clientX - s.x;
    return s.w + (edge === 'right' ? dx : -dx);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    onResize(clamp(raw(e), limits.min, limits.max));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const w = raw(e);
    const widthBefore = start.current.w;
    start.current = null;
    setDragging(false);
    document.body.classList.remove('pc-resizing');
    if (w < limits.collapseBelow) {
      // Dragged shut: hide it, and bring it back later at the size it had.
      onResize(widthBefore);
      onCollapse();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onResize(limits.default)}
      className={`absolute top-0 bottom-0 z-30 w-2 cursor-col-resize group ${edge === 'right' ? '-right-1' : '-left-1'}`}
    >
      <div
        className={`mx-auto h-full w-0.5 transition-colors ${
          dragging ? 'bg-app-highlight' : 'bg-transparent group-hover:bg-app-highlight/60'
        }`}
      />
    </div>
  );
};
