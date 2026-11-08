import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: React.ElementType;
  danger?: boolean;
  onClick: () => void;
}

interface OpenMenu {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * A right-click menu. `onContextMenu={e => menu.open(e, items)}` on any element,
 * and render `{menu.element}` once in the component. On phones a long press
 * fires the same contextmenu event, so the menu works there too.
 */
export function useContextMenu() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const open = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  const element = menu ? <ContextMenuPopup {...menu} onClose={close} /> : null;
  return { open, close, element };
}

const ContextMenuPopup: React.FC<OpenMenu & { onClose: () => void }> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu on screen (open to the left / upwards near the edges).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, y + height > window.innerHeight - margin ? y - height : y),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('touchstart', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('touchstart', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[400] min-w-[200px] py-1.5 rounded-xl bg-app-solid border border-app-theme shadow-2xl anim-fade"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={i}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2 text-sm text-left transition-colors hover:bg-app-card ${
              item.danger ? 'text-red-400' : 'text-app-primary'
            }`}
          >
            {Icon && <Icon className="w-4 h-4 shrink-0" />}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
};
