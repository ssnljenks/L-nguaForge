import React, {useEffect, useRef} from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, innermost last: only the top one handles Escape/Tab when dialogs stack. */
const dialogStack: HTMLElement[] = [];

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0
  );
}

interface DialogProps {
  /** id of the element that names the dialog (usually its heading). */
  labelledBy: string;
  onClose: () => void;
  /** Close when the dimmed backdrop is clicked. */
  closeOnBackdrop?: boolean;
  /** 'modal' centers the dialog; 'sheet' docks it to the bottom on mobile and centers on sm+. */
  variant?: 'modal' | 'sheet';
  /** Classes for the dialog card itself. */
  className?: string;
  overlayClassName?: string;
  children: React.ReactNode;
}

/**
 * Accessible modal dialog: Escape closes, Tab/Shift+Tab stay inside, focus moves into the dialog
 * on open and returns to the previously focused element on close, and page scroll is locked.
 * Render it only while open.
 */
export const Dialog: React.FC<DialogProps> = ({
  labelledBy,
  onClose,
  closeOnBackdrop = false,
  variant = 'modal',
  className = '',
  overlayClassName = 'bg-black/75',
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogStack.push(dialog);
    dialog.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== dialog) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = dialogStack.lastIndexOf(dialog);
      if (index !== -1) dialogStack.splice(index, 1);
      if (dialogStack.length === 0) document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const layoutClass =
    variant === 'sheet' ? 'items-end sm:items-center justify-center p-0 sm:p-4' : 'items-center justify-center p-4';

  return (
    <div className={`fixed inset-0 z-50 flex backdrop-blur-sm ${layoutClass} ${overlayClassName}`}>
      {closeOnBackdrop && <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`relative outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
};
