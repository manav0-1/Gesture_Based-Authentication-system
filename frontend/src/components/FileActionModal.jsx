import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';
import { buildFileViewUrl } from '../utils/api';

function formatFileSize(size) {
  if (!Number.isFinite(size)) return '--';
  if (size < 1024) return `${size} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
}

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function getTypeLabel(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'Image';
  if (mimetype.startsWith('video/')) return 'Video';
  if (mimetype.startsWith('audio/')) return 'Audio';
  if (mimetype === 'application/pdf') return 'PDF';
  return 'Document';
}

export default function FileActionModal({
  file,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const token = useAuthStore((state) => state.token);

  if (!isOpen || !file) return null;

  const secureUrl = buildFileViewUrl(file._id, token);
  const isImage = file.mimetype.startsWith('image/');
  const isVideo = file.mimetype.startsWith('video/');
  const isAudio = file.mimetype.startsWith('audio/');
  const typeLabel = getTypeLabel(file.mimetype);

  const handleUpdate = async () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === file.originalname) {
      setIsEditing(false);
      setNewName(file.originalname);
      return;
    }

    const ok = await onUpdate(file._id, trimmed);
    if (ok) onClose();
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this file permanently?')) return;
    const ok = await onDelete(file._id);
    if (ok) onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-slate-950/80" />

        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          onClick={(event) => event.stopPropagation()}
          className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl glass-card"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-400">{typeLabel}</p>

              {isEditing ? (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleUpdate();
                    }}
                    autoFocus
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-slate-100 outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={handleUpdate}
                    className="button-primary rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setNewName(file.originalname);
                    }}
                    className="button-secondary rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <h2 className="mt-1 truncate text-xl font-semibold text-white" title={file.originalname}>
                  {file.originalname}
                </h2>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[1.4fr_0.8fr]">
            <div className="flex min-h-[280px] items-center justify-center surface p-5 lg:border-r lg:border-slate-700/50">
              {isImage && (
                <img
                  src={secureUrl}
                  alt={file.originalname}
                  className="max-h-[60vh] w-auto rounded-xl object-contain"
                />
              )}

              {isVideo && (
                <video
                  src={secureUrl}
                  controls
                  className="max-h-[60vh] w-full rounded-xl bg-black"
                />
              )}

              {isAudio && (
                <div className="w-full max-w-md rounded-xl surface-strong p-5">
                  <p className="mb-4 text-center font-semibold text-white">Audio file</p>
                  <audio src={secureUrl} controls className="w-full" />
                </div>
              )}

              {!isImage && !isVideo && !isAudio && (
                <div className="max-w-sm text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl border border-slate-700 text-lg font-semibold text-slate-300">
                    {typeLabel.toUpperCase().slice(0, 3)}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-white">Preview unavailable</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Open the file in a new tab or download it to view it.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-5 overflow-y-auto p-5">
              <div className="space-y-3">
                <a
                  href={secureUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button-primary flex justify-center rounded-lg px-4 py-3 text-sm font-semibold"
                >
                  Open in new tab
                </a>
                <a
                  href={secureUrl}
                  download
                  className="button-secondary flex justify-center rounded-lg px-4 py-3 text-sm font-semibold"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setNewName(file.originalname);
                    setIsEditing(true);
                  }}
                  className="w-full rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-full rounded-lg border border-red-400/30 px-4 py-3 text-sm font-semibold text-red-200 hover:bg-red-500/10"
                >
                  Delete
                </button>
              </div>

              <div className="rounded-xl surface p-4">
                <h3 className="font-semibold text-white">Details</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Type</dt>
                    <dd className="truncate text-slate-200">{typeLabel}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Size</dt>
                    <dd className="truncate text-slate-200">{formatFileSize(file.size)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Added</dt>
                    <dd className="truncate text-slate-200">{formatDate(file.createdAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">MIME</dt>
                    <dd className="truncate text-slate-200">{file.mimetype || '--'}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
