'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface VideoUploadModalProps {
  classId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function VideoUploadModal({ classId, isOpen, onClose, onSuccess }: VideoUploadModalProps) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type (mp4 only for now)
      if (selectedFile.type !== 'video/mp4') {
        setError('Please select an MP4 video file');
        return;
      }

      // Validate file size (500 MB limit — must match Supabase bucket file_size_limit)
      const maxSize = 500 * 1024 * 1024; // 500 MB
      if (selectedFile.size > maxSize) {
        setError(`File size must be less than 500 MB (your file is ${(selectedFile.size / 1024 / 1024).toFixed(0)} MB)`);
        return;
      }

      setFile(selectedFile);
      setError('');

      // Auto-fill title from filename if empty
      if (!title) {
        const filename = selectedFile.name.replace('.mp4', '');
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
      setUploadProgress(5);

      // Verify the user has an active Supabase session before uploading
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.user) {
        setError('Your session has expired. Please sign out and sign back in.');
        setUploading(false);
        setUploadProgress(0);
        return;
      }

      console.log('Uploading as user:', sessionData.session.user.id);
      setUploadProgress(10);

      setUploadProgress(20);

      // Step 1: Get a pre-signed S3 URL from our API route
      const presignRes = await fetch('/api/upload-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          classId,
          type: 'video',
        }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.json();
        throw new Error(err.error || 'Failed to get upload URL');
      }

      const { presignedUrl, storagePath } = await presignRes.json();

      setUploadProgress(35);

      // Step 2: Upload directly to S3 using the pre-signed URL
      // This bypasses Supabase's 50MB free tier limit entirely
      const s3Res = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!s3Res.ok) {
        throw new Error(`S3 upload failed: ${s3Res.status} ${s3Res.statusText}`);
      }

      setUploadProgress(70);

      // Create video element to get duration
      const video = document.createElement('video');
      video.preload = 'metadata';

      const getDuration = (): Promise<number> => {
        return new Promise((resolve) => {
          video.onloadedmetadata = () => {
            window.URL.revokeObjectURL(video.src);
            resolve(Math.floor(video.duration));
          };
          video.src = URL.createObjectURL(file);
        });
      };

      const duration = await getDuration();

      setUploadProgress(80);

      // Create recording record in database
      const { error: recordingError } = await supabase
        .from('recordings')
        .insert({
          class_id: classId,
          title: title.trim(),
          video_url: storagePath, // Store the storage path
          storage_path: storagePath,
          duration: duration,
          processing_status: 'pending'
        })
        .select()
        .single();

      if (recordingError) throw recordingError;

      setUploadProgress(100);

      // Success!
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 500);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload video';
      console.error('Upload error:', err);
      setError(message);
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
          <h3 className="text-lg font-semibold text-gray-900">Upload Video</h3>
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
              Video Title
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Lecture 1: Introduction"
              disabled={uploading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 disabled:bg-gray-100"
            />
          </div>

          {/* File Input */}
          <div>
            <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-1">
              Video File (MP4)
            </label>
            <input
              type="file"
              id="file"
              accept="video/mp4"
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
              Video will be stored in Supabase Storage. Future processing features will be added.
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
