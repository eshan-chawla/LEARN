'use client';

import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

interface BookNotesPanelProps {
  open: boolean;
  desktopWidth: number;
  resizing: boolean;
  loading: boolean;
  noteContent: string;
  saving: boolean;
  error: string | null;
  lastUpdated: string | null;
  onClose: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onResizeStart: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export function BookNotesPanel({
  open,
  desktopWidth,
  resizing,
  loading,
  noteContent,
  saving,
  error,
  lastUpdated,
  onClose,
  onChange,
  onSave,
  onResizeStart,
}: BookNotesPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
    }
  }, [open]);

  const panelStyle = {
    '--book-notes-width': `${desktopWidth}px`,
  } as CSSProperties;

  return (
    <aside
      style={panelStyle}
      className={`absolute inset-y-0 right-0 z-20 flex w-[24rem] flex-col overflow-hidden bg-[rgba(250,247,242,0.98)] ${resizing ? 'transition-[transform,opacity,box-shadow,border-color] duration-75' : 'transition-[transform,width,opacity,box-shadow,border-color] duration-300'} md:relative md:inset-y-auto md:right-auto md:z-0 md:flex-shrink-0 md:translate-x-0 ${open ? 'pointer-events-auto translate-x-0 border-l border-stone-200/80 opacity-100 shadow-[-24px_24px_60px_rgba(28,25,23,0.12)] md:w-[var(--book-notes-width)] md:shadow-none' : 'pointer-events-none translate-x-full border-l border-transparent opacity-100 md:w-0 md:translate-x-0 md:border-l-0 md:opacity-0 md:shadow-none'}`}
      aria-hidden={!open}
    >
      {open && (
        <button
          type="button"
          onMouseDown={onResizeStart}
          className="absolute inset-y-0 left-0 hidden w-4 cursor-col-resize items-center justify-center md:flex"
          aria-label="Resize Notes panel"
          title="Drag to resize"
        >
          <span className={`h-16 w-px rounded-full transition-colors ${resizing ? 'bg-sky-500' : 'bg-stone-300'}`} />
        </button>
      )}

      <div className="flex items-center justify-between gap-3 border-b border-stone-200/80 px-4 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Notes</p>
          <p className="mt-2 text-sm leading-6 text-stone-600">Private markdown notes for this class.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-stone-200 bg-white/80 text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
          aria-label="Close Notes panel"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 px-4 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center rounded-[24px] border border-stone-200 bg-white/80">
            <div className="text-center">
              <div className="mx-auto h-7 w-7 animate-spin rounded-full border-b-2 border-stone-700" />
              <p className="mt-3 text-sm text-stone-500">Loading notes...</p>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {error && (
              <div className="mb-4 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden rounded-[24px] border border-stone-200 bg-white/88 shadow-[0_12px_30px_rgba(28,25,23,0.06)]">
              <textarea
                ref={textareaRef}
                value={noteContent}
                onChange={(event) => onChange(event.target.value)}
                placeholder="Write your markdown notes here..."
                className="h-full w-full resize-none bg-transparent px-5 py-4 text-[15px] leading-7 text-stone-800 outline-none transition focus:bg-white"
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-stone-200/80 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-xs leading-5 text-stone-500">
            {lastUpdated ? (
              <p className="truncate">Last updated: {new Date(lastUpdated).toLocaleString()}</p>
            ) : (
              <p>Markdown supported.</p>
            )}
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={loading || saving}
            className="inline-flex items-center justify-center rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-stone-50 shadow-[0_12px_30px_rgba(28,25,23,0.2)] transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </aside>
  );
}
