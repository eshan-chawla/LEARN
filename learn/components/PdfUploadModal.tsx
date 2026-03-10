'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface PdfUploadModalProps {
  classId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PdfUploadModal({ classId, userId, isOpen, onClose, onSuccess }: PdfUploadModalProps) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'application/pdf') {
        setError('Please select a PDF file');
        return;
      }

      // 500 MB limit — uploads go to S3, not Supabase
      const maxSize = 500 * 1024 * 1024;
      if (selectedFile.size > maxSize) {
        setError(`File size must be less than 500 MB (your file is ${(selectedFile.size / 1024 / 1024).toFixed(0)} MB)`);
        return;
      }

      setFile(selectedFile);
      setError('');

      if (!title) {
        setTitle(selectedFile.name.replace('.pdf', ''));
      }
    }
  };

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      setError('Please provide both a title and a file');
      return;
    }

    try {
      setUploading(true);
      setError('');
      setUploadProgress(5);

      // Verify active Supabase session
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.user) {
        setError('Your session has expired. Please sign out and sign back in.');
        setUploading(false);
        setUploadProgress(0);
        return;
      }

      setUploadProgress(10);

      // Step 1: Get a pre-signed S3 PUT URL from our API
      const presignRes = await fetch('/api/upload-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          userId,
          type: 'pdf',
        }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.json();
        throw new Error(err.error || 'Failed to get upload URL');
      }

      const { presignedUrl, publicUrl, storagePath } = await presignRes.json();

      setUploadProgress(30);

      // Step 2: Upload directly to S3 (bypasses Supabase 50 MB limit entirely)
      const s3Res = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!s3Res.ok) {
        throw new Error(`S3 upload failed: ${s3Res.status} ${s3Res.statusText}`);
      }

      setUploadProgress(70);

      // Step 3: Save book record to Supabase with the S3 public URL
      const { data: bookData, error: bookError } = await supabase
        .from('books')
        .insert({
          class_id: classId,
          title: title.trim(),
          pdf_url: publicUrl,
          storage_path: storagePath,
          file_size: file.size,
          processing_status: 'pending',
        })
        .select()
        .single();

      if (bookError) throw bookError;

      setUploadProgress(85);

      // Step 4: Create a PDF processing job for Lambda/embeddings
      const { data: jobData, error: jobError } = await supabase
        .from('pdf_processing_jobs')
        .insert({
          book_id: bookData.id,
          status: 'pending',
          progress: 0,
        })
        .select()
        .single();

      if (jobError) throw jobError;

      setUploadProgress(95);

      // Step 5: Trigger Lambda to process the PDF
      const processRes = await fetch('/api/process-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_id: bookData.id,
          job_id: jobData.id,
          storage_path: storagePath,
        }),
      });

      if (!processRes.ok) {
        // Non-fatal: log but don't fail the upload
        console.warn('PDF processing trigger failed:', await processRes.json());
      }

      setUploadProgress(100);

      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 500);

    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Failed to upload PDF');
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setTitle('');
      setFile(null);
      setError('');
      setUploadProgress(0);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Upload PDF Book</h3>
          <button
            onClick={handleClose}
            disabled={uploading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="pdf-title" className="block text-sm font-medium text-gray-700 mb-1">
              Book Title
            </label>
            <input
              type="text"
              id="pdf-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Introduction to Python"
              disabled={uploading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 disabled:bg-gray-100"
            />
          </div>

          {/* File picker */}
          <div>
            <label htmlFor="pdf-file" className="block text-sm font-medium text-gray-700 mb-1">
              PDF File (up to 500 MB)
            </label>
            <input
              type="file"
              id="pdf-file"
              accept="application/pdf"
              onChange={handleFileChange}
              disabled={uploading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 disabled:bg-gray-100"
            />
            {file && (
              <p className="text-sm text-gray-500 mt-1">
                {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>

          {/* Progress bar */}
          {uploading && (
            <div>
              <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                <span>Uploading to S3...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-sm text-blue-700">
              The PDF will be stored in AWS S3 and processed to generate embeddings for search and Q&A.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
          <button
            onClick={handleClose}
            disabled={uploading}
            className="px-4 py-2 text-gray-700 hover:text-gray-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !file || !title.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
