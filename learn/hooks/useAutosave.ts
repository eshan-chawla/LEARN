import { useEffect, useRef, useCallback, useState } from 'react';
import { debounce } from '@/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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

  const lastSavedValue = useRef(initialValue);
  const isSaving = useRef(false);

  // Function to perform the actual save
  const performSave = useCallback(async (valueToSave: string) => {
    // Don't save if already saving or if value hasn't changed
    if (isSaving.current || valueToSave === lastSavedValue.current) {
      return;
    }

    isSaving.current = true;
    setStatus('saving');
    setError(null);

    try {
      await onSave(valueToSave);
      lastSavedValue.current = valueToSave;
      setStatus('saved');

      // Reset to idle after 2 seconds
      setTimeout(() => {
        setStatus('idle');
      }, 2000);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to save');
      console.error('Autosave error:', err);
    } finally {
      isSaving.current = false;
    }
  }, [onSave]);

  // Create debounced save function
  const debouncedSave = useRef(
    debounce((valueToSave: string) => {
      performSave(valueToSave);
    }, delay)
  );

  // Update debounced function if delay changes
  useEffect(() => {
    debouncedSave.current = debounce((valueToSave: string) => {
      performSave(valueToSave);
    }, delay);
  }, [delay, performSave]);

  // Trigger debounced save when value changes
  useEffect(() => {
    if (value !== lastSavedValue.current) {
      debouncedSave.current(value);
    }
  }, [value]);

  // Manual save function (bypasses debounce)
  const save = useCallback(async () => {
    await performSave(value);
  }, [value, performSave]);

  return {
    value,
    setValue,
    status,
    error,
    save,
  };
}
