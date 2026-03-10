'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface ProcessingStatusBadgeProps {
  bookId: string;
  initialStatus: ProcessingStatus;
  onStatusChange?: (status: ProcessingStatus) => void;
}

export function ProcessingStatusBadge({ bookId, initialStatus, onStatusChange }: ProcessingStatusBadgeProps) {
  const [status, setStatus] = useState<ProcessingStatus>(initialStatus);

  useEffect(() => {
    if (status !== 'pending' && status !== 'processing') return;

    // Poll books.processing_status directly every 5 seconds
    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('books')
          .select('processing_status')
          .eq('id', bookId)
          .single();

        if (!error && data && data.processing_status !== status) {
          setStatus(data.processing_status as ProcessingStatus);
          onStatusChange?.(data.processing_status as ProcessingStatus);
        }
      } catch (err) {
        console.error('Error polling book status:', err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [status, bookId, onStatusChange]);

  const display = {
    pending: {
      text: 'Queued',
      color: 'bg-gray-100 text-gray-700',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    processing: {
      text: 'Processing...',
      color: 'bg-blue-100 text-blue-700',
      icon: (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ),
    },
    completed: {
      text: 'Ready',
      color: 'bg-green-100 text-green-700',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    failed: {
      text: 'Failed',
      color: 'bg-red-100 text-red-700',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
    },
  };

  const { text, color, icon } = display[status];

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
      {icon}
      <span>{text}</span>
    </div>
  );
}
