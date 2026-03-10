import { useEffect, useRef, useCallback, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'object' && error !== null) {
    if ('message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }

    if ('error_description' in error) {
      const description = (error as { error_description?: unknown }).error_description;
      if (typeof description === 'string' && description.trim()) return description;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Ignore serialization issues and use fallback below.
    }
  }

  return fallback;
}

interface UseAutosaveOptions {
  /**
   * The function to call when saving
   */
  onSave: (value: string) => Promise<void>;

  /**
   * Debounce delay in milliseconds (default: 2000ms = 2 seconds)
   */
  delay?: number;

  /**
   * Initial value
   */
  initialValue?: string;
}

interface UseAutosaveReturn {
  /**
   * Current value
   */
  value: string;

  /**
   * Function to update the value
   */
  setValue: (value: string) => void;

  /**
   * Replace local value without triggering autosave
   */
  resetValue: (value: string) => void;

  /**
   * Current save status
   */
  status: SaveStatus;

  /**
   * Error message if status is 'error'
   */
  error: string | null;

  /**
   * Manually trigger a save
   */
  save: () => Promise<void>;
}

/**
 * Custom hook for autosaving content with debouncing
 *
 * @example
 * const { value, setValue, status } = useAutosave({
 *   onSave: async (content) => {
 *     await updateNote(noteId, content);
 *   },
 *   delay: 2000,
 *   initialValue: note.content
 * });
 */
export function useAutosave({
  onSave,
  delay = 2000,
  initialValue = '',
}: UseAutosaveOptions): UseAutosaveReturn {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const onSaveRef = useRef(onSave);
  const valueRef = useRef(initialValue);
  const lastSavedValue = useRef(initialValue);
  const isSaving = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  const scheduleSaveRef = useRef<(valueToSave: string) => void>(() => {});

  const performSave = useCallback(async (valueToSave: string) => {
    if (isSaving.current || valueToSave === lastSavedValue.current) {
      return;
    }

    isSaving.current = true;
    clearStatusTimer();
    setStatus('saving');
    setError(null);

    try {
      await onSaveRef.current(valueToSave);
      lastSavedValue.current = valueToSave;
      setStatus('saved');

      statusTimerRef.current = setTimeout(() => {
        setStatus('idle');
        statusTimerRef.current = null;
      }, 2000);
    } catch (err) {
      setStatus('error');
      setError(getErrorMessage(err, 'Failed to save'));
      console.error('Autosave error:', err);
    } finally {
      isSaving.current = false;

      if (valueRef.current !== lastSavedValue.current) {
        scheduleSaveRef.current(valueRef.current);
      }
    }
  }, [clearStatusTimer]);

  useEffect(() => {
    scheduleSaveRef.current = (valueToSave: string) => {
      clearSaveTimer();

      if (valueToSave === lastSavedValue.current) {
        return;
      }

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void performSave(valueToSave);
      }, delay);
    };
  }, [clearSaveTimer, delay, performSave]);

  const updateValue = useCallback((nextValue: string) => {
    valueRef.current = nextValue;
    setValue(nextValue);
  }, []);

  const resetValue = useCallback((nextValue: string) => {
    clearSaveTimer();
    clearStatusTimer();
    valueRef.current = nextValue;
    lastSavedValue.current = nextValue;
    setValue(nextValue);
    setStatus('idle');
    setError(null);
  }, [clearSaveTimer, clearStatusTimer]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (value !== lastSavedValue.current) {
      scheduleSaveRef.current(value);
    } else {
      clearSaveTimer();
    }
  }, [clearSaveTimer, value]);

  useEffect(() => {
    return () => {
      clearSaveTimer();
      clearStatusTimer();
    };
  }, [clearSaveTimer, clearStatusTimer]);

  // Manual save function (bypasses debounce)
  const save = useCallback(async () => {
    clearSaveTimer();
    await performSave(valueRef.current);
  }, [clearSaveTimer, performSave]);

  return {
    value,
    setValue: updateValue,
    resetValue,
    status,
    error,
    save,
  };
}
