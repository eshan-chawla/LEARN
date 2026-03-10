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
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFileLabel, setCurrentFileLabel] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const formatSize = (size: number) => `${(size / 1024 / 1024).toFixed(2)} MB`;

  const getVideoTitle = (filename: string) => filename.replace(/\.mp4$/i, '');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);

    if (selectedFiles.length > 0) {
      const invalidTypeFile = selectedFiles.find((selectedFile) => selectedFile.type !== 'video/mp4');
      if (invalidTypeFile) {
        setError(`Only MP4 files are allowed: ${invalidTypeFile.name}`);
        return;
      }

      // Validate file size (500 MB limit — must match Supabase bucket file_size_limit)
      const maxSize = 500 * 1024 * 1024; // 500 MB
      const oversizedFile = selectedFiles.find((selectedFile) => selectedFile.size > maxSize);
      if (oversizedFile) {
        setError(`File size must be less than 500 MB (${oversizedFile.name} is ${formatSize(oversizedFile.size)})`);
        return;
      }

      setFiles(selectedFiles);
      setError('');
    }
  };

  const getDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(Math.floor(video.duration));
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const uploadSingleFile = async (file: File, index: number, total: number) => {
    const baseProgress = Math.floor((index / total) * 100);
    const progressSlice = Math.ceil(100 / total);

    setCurrentFileLabel(file.name);
    setUploadProgress(Math.min(baseProgress + 5, 100));

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
      throw new Error(err.error || `Failed to get upload URL for ${file.name}`);
    }

    const { presignedUrl, storagePath } = await presignRes.json();

    setUploadProgress(Math.min(baseProgress + Math.floor(progressSlice * 0.35), 100));

    const s3Res = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });

    if (!s3Res.ok) {
      throw new Error(`S3 upload failed for ${file.name}: ${s3Res.status} ${s3Res.statusText}`);
    }

    setUploadProgress(Math.min(baseProgress + Math.floor(progressSlice * 0.7), 100));

    const duration = await getDuration(file);

    const { error: recordingError } = await supabase
      .from('recordings')
      .insert({
        class_id: classId,
        title: getVideoTitle(file.name),
        video_url: storagePath,
        storage_path: storagePath,
        duration,
        processing_status: 'pending',
      })
      .select()
      .single();

    if (recordingError) throw recordingError;

    setUploadProgress(Math.min(baseProgress + progressSlice, 100));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Please select at least one MP4 file');
      return;
    }

    try {
      setUploading(true);
      setError('');
      setUploadProgress(0);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.user) {
        setError('Your session has expired. Please sign out and sign back in.');
        setUploading(false);
        setUploadProgress(0);
        return;
      }

      for (const [index, file] of files.entries()) {
        await uploadSingleFile(file, index, files.length);
      }

      setUploadProgress(100);

      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload video files';
      console.error('Upload error:', err);
      setError(message);
      setUploadProgress(0);
    } finally {
      setUploading(false);
      setCurrentFileLabel('');
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      setError('');
      setUploadProgress(0);
      setCurrentFileLabel('');
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
          {/* File Input */}
          <div>
            <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-1">
              Video Files (MP4)
            </label>
            <input
              type="file"
              id="file"
              accept="video/mp4"
              multiple
              onChange={handleFileChange}
              disabled={uploading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 disabled:bg-gray-100"
            />
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((file) => (
                  <p key={`${file.name}-${file.size}`} className="text-sm text-gray-500 mt-1">
                    {file.name} ({formatSize(file.size)})
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Upload Progress */}
          {uploading && (
            <div>
              <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                <span>{currentFileLabel ? `Uploading ${currentFileLabel}...` : 'Uploading videos...'}</span>
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
              Videos are uploaded directly to AWS S3 and each filename becomes the recording title automatically.
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
            disabled={uploading || files.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : files.length > 1 ? `Upload ${files.length} Videos` : 'Upload Video'}
          </button>
        </div>
      </div>
    </div>
  );
}
