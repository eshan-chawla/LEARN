'use client';

import { useEffect, useState } from 'react';

type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface ProcessingStatusBadgeProps {
  bookId: string;
  initialStatus: ProcessingStatus;
  onStatusChange?: (status: ProcessingStatus) => void;
}

export function ProcessingStatusBadge({ bookId, initialStatus, onStatusChange }: ProcessingStatusBadgeProps) {
  const [status, setStatus] = useState<ProcessingStatus>(initialStatus);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Only poll if status is pending or processing
    if (status === 'pending' || status === 'processing') {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(`/api/process-pdf?book_id=${bookId}`);
          if (response.ok) {
            const data = await response.json();
            if (data.status !== status) {
              setStatus(data.status);
              onStatusChange?.(data.status);
            }
            if (data.progress !== undefined) {
              setProgress(data.progress);
            }
          }
        } catch (error) {
          console.error('Error polling job status:', error);
        }
      }, 3000); // Poll every 3 seconds

      return () => clearInterval(interval);
    }
  }, [status, bookId, onStatusChange]);

  const getStatusDisplay = () => {
    switch (status) {
      case 'pending':
        return {
          text: 'Queued',
          color: 'bg-gray-100 text-gray-700',
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        };
      case 'processing':
        return {
          text: `Processing... ${progress}%`,
          color: 'bg-blue-100 text-blue-700',
          icon: (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          )
        };
      case 'completed':
        return {
          text: 'Ready',
          color: 'bg-green-100 text-green-700',
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )
        };
      case 'failed':
        return {
          text: 'Failed',
          color: 'bg-red-100 text-red-700',
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )
        };
    }
  };

  const { text, color, icon } = getStatusDisplay();

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
      {icon}
      <span>{text}</span>
    </div>
  );
}
