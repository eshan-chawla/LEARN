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
      // Validate file type
      if (selectedFile.type !== 'application/pdf') {
        setError('Please select a PDF file');
        return;
      }

      // Validate file size (50 MB limit)
      const maxSize = 50 * 1024 * 1024; // 50 MB
      if (selectedFile.size > maxSize) {
        setError('File size must be less than 50 MB');
        return;
      }

      setFile(selectedFile);
      setError('');

      // Auto-fill title from filename if empty
      if (!title) {
        const filename = selectedFile.name.replace('.pdf', '');
        setTitle(filename);
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
      setUploadProgress(10);

      // Generate unique filename
      const timestamp = Date.now();
      const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `${userId}/${timestamp}_${sanitizedFilename}`;

      setUploadProgress(30);

      // Upload file to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('books')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      setUploadProgress(60);

      // Create book record in database (store storage_path, not URL)
      const { data: bookData, error: bookError } = await supabase
        .from('books')
        .insert({
          class_id: classId,
          title: title.trim(),
          pdf_url: storagePath, // Store the storage path instead of URL
          storage_path: storagePath,
          file_size: file.size,
          processing_status: 'pending'
        })
        .select()
        .single();

      setUploadProgress(80);

      if (bookError) throw bookError;

      setUploadProgress(90);

      // Create processing job
      const { data: jobData, error: jobError } = await supabase
        .from('pdf_processing_jobs')
        .insert({
          book_id: bookData.id,
          status: 'pending',
          progress: 0
        })
        .select()
        .single();

      if (jobError) throw jobError;

      setUploadProgress(95);

      // Trigger Lambda processing via API route
      const response = await fetch('/api/process-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          book_id: bookData.id,
          job_id: jobData.id,
          storage_path: storagePath
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start PDF processing');
      }

      setUploadProgress(100);

      // Success!
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
          {/* Title Input */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
              Book Title
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Introduction to Python"
              disabled={uploading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 disabled:bg-gray-100"
            />
          </div>

          {/* File Input */}
          <div>
            <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-1">
              PDF File
            </label>
            <input
              type="file"
              id="file"
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

          {/* Upload Progress */}
          {uploading && (
            <div>
              <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                <span>Uploading...</span>
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

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Info Message */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-sm text-blue-700">
              The PDF will be processed to generate embeddings for search and Q&A. This may take a few minutes.
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
