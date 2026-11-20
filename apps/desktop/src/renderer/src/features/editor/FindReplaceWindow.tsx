import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, X } from "lucide-react";
import type { MessageKey } from "../../i18n/index.js";

interface Position {
  x: number;
  y: number;
}

export function FindReplaceWindow({
  open,
  onClose,
  children,
  t,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly t: (key: MessageKey) => string;
}): JSX.Element | null {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const drag = useRef<{
    pointerId: number;
    origin: Position;
    start: Position;
  } | null>(null);

  function constrain(next: Position): Position {
    const bounds = panel.current?.getBoundingClientRect();
    return {
      x: Math.max(
        8,
        Math.min(next.x, window.innerWidth - (bounds?.width ?? 500) - 8),
      ),
      y: Math.max(
        8,
        Math.min(next.y, window.innerHeight - (bounds?.height ?? 180) - 8),
      ),
    };
  }

  useLayoutEffect(() => {
    if (!open) return;
    const keepVisible = (): void =>
      setPosition((current) =>
        constrain(current ?? { x: window.innerWidth - 540, y: 110 }),
      );
    keepVisible();
    window.addEventListener("resize", keepVisible);
    return () => {
      drag.current = null;
      window.removeEventListener("resize", keepVisible);
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      className="find-replace-window"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={{ left: position?.x ?? 8, top: position?.y ?? 8 }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="find-window-header">
        <button
          type="button"
          className="find-window-drag"
          aria-label={t("editorMoveFindWindow")}
          title={t("editorMoveFindWindow")}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            const bounds = panel.current?.getBoundingClientRect();
            if (bounds === undefined) return;
            drag.current = {
              pointerId: event.pointerId,
              origin: { x: bounds.x, y: bounds.y },
              start: { x: event.clientX, y: event.clientY },
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (current === null || current.pointerId !== event.pointerId)
              return;
            setPosition(
              constrain({
                x: current.origin.x + event.clientX - current.start.x,
                y: current.origin.y + event.clientY - current.start.y,
              }),
            );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 40 : 10;
            const offsets: Record<string, Position> = {
              ArrowLeft: { x: -step, y: 0 },
              ArrowRight: { x: step, y: 0 },
              ArrowUp: { x: 0, y: -step },
              ArrowDown: { x: 0, y: step },
            };
            const offset = offsets[event.key];
            if (offset === undefined) return;
            event.preventDefault();
            setPosition((current) =>
              constrain({
                x: (current?.x ?? 8) + offset.x,
                y: (current?.y ?? 8) + offset.y,
              }),
            );
          }}
        >
          <GripHorizontal size={16} aria-hidden="true" />
          <span id={titleId}>{t("editorFindReplace")}</span>
        </button>
        <button
          type="button"
          className="find-window-close"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      {children}
    </div>,
    document.body,
  );
}
