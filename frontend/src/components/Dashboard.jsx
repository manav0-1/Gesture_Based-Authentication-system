import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';
import useFileStore from '../store/useFileStore';
import { buildFileViewUrl } from '../utils/api';
import FileActionModal from './FileActionModal';
import useSound from '../hooks/useSound';

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

function getFileCategory(mimetype = '') {
  if (mimetype.startsWith('image/')) return { id: 'image', label: 'Image', short: 'IMG' };
  if (mimetype.startsWith('video/')) return { id: 'video', label: 'Video', short: 'VID' };
  if (mimetype.startsWith('audio/')) return { id: 'audio', label: 'Audio', short: 'AUD' };
  if (mimetype === 'application/pdf') return { id: 'pdf', label: 'PDF', short: 'PDF' };
  return { id: 'other', label: 'Document', short: 'DOC' };
}

function StatCard({ label, value }) {
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="surface p-4">
      <p className="gradient-title text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
    </motion.div>
  );
}

function EmptyState({ hasFiles }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="surface px-6 py-14 text-center">
      <h3 className="text-lg font-semibold text-white">
        {hasFiles ? 'No files match your search' : 'No files yet'}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
        {hasFiles
          ? 'Try a different search term or choose another file type.'
          : 'Upload a file to start using your protected storage.'}
      </p>
    </motion.div>
  );
}

function DragDropZone({ onDrop, children }) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onDrop(file);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative min-h-screen"
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-6"
          >
            <div className="rounded-2xl border border-emerald-400/30 bg-slate-900 px-8 py-6 text-center">
              <h3 className="text-lg font-semibold text-white">Drop file to upload</h3>
              <p className="mt-2 text-sm text-slate-400">The upload will start automatically.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const token = useAuthStore((state) => state.token);
  const { files, fetchFiles, uploadFile, updateFileName, deleteFile, isLoading, success, error } =
    useFileStore();
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const { playHover, playSuccess, playError } = useSound();

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleFileUpload = async (fileOrEvent) => {
    const file = fileOrEvent?.target ? fileOrEvent.target.files[0] : fileOrEvent;
    if (!file) return;

    const ok = await uploadFile(file);
    if (ok) {
      playSuccess();
    } else {
      playError();
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return files.filter((file) => {
      const category = getFileCategory(file.mimetype);
      const matchesQuery =
        !normalizedQuery ||
        file.originalname.toLowerCase().includes(normalizedQuery) ||
        category.label.toLowerCase().includes(normalizedQuery);

      const matchesFilter =
        filter === 'all' ||
        (filter === 'documents' && ['pdf', 'other'].includes(category.id)) ||
        category.id === filter;

      return matchesQuery && matchesFilter;
    });
  }, [files, filter, query]);

  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
    [files]
  );

  const newestFile = useMemo(() => {
    if (!files.length) return null;
    return [...files].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    )[0];
  }, [files]);

  const filterCounts = useMemo(() => {
    const counts = {
      all: files.length,
      image: 0,
      video: 0,
      audio: 0,
      documents: 0,
    };

    files.forEach((file) => {
      const category = getFileCategory(file.mimetype);
      if (category.id === 'image') counts.image += 1;
      if (category.id === 'video') counts.video += 1;
      if (category.id === 'audio') counts.audio += 1;
      if (['pdf', 'other'].includes(category.id)) counts.documents += 1;
    });

    return counts;
  }, [files]);

  return (
    <DragDropZone onDrop={handleFileUpload}>
      <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.1 } } }} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <motion.section variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="glass-card p-5 sm:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white">Your files</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Upload and manage files after signing in with your gesture.
              </p>
            </div>

            <div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onMouseEnter={playHover}
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="button-primary rounded-lg px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                Upload file
              </button>
            </div>
          </div>
        </motion.section>

        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total files" value={files.length} />
          <StatCard label="Storage used" value={formatFileSize(totalSize)} />
          <StatCard label="Newest upload" value={newestFile ? formatDate(newestFile.createdAt) : '--'} />
          <StatCard label="Shown now" value={filteredFiles.length} />
        </motion.div>

        <div className="mt-5 space-y-3">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {success && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
              >
                {success}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.section variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="glass-card mt-5 p-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
            />

            <div className="flex flex-wrap gap-2">
              {[
                ['all', 'All'],
                ['image', 'Images'],
                ['video', 'Videos'],
                ['audio', 'Audio'],
                ['documents', 'Documents'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onMouseEnter={playHover}
                  onClick={() => setFilter(id)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    filter === id
                      ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {label} ({filterCounts[id]})
                </button>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }} className="mt-5">
          {filteredFiles.length === 0 ? (
            <EmptyState hasFiles={files.length > 0} />
          ) : (
            <motion.div variants={{ visible: { transition: { staggerChildren: 0.05 } } }} initial="hidden" animate="visible" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence>
              {filteredFiles.map((file) => {
                const category = getFileCategory(file.mimetype);
                const secureUrl = buildFileViewUrl(file._id, token);
                const isImage = file.mimetype.startsWith('image/');

                return (
                  <motion.button
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    key={file._id}
                    type="button"
                    onMouseEnter={playHover}
                    onClick={() => setSelectedFile(file)}
                    className="surface overflow-hidden text-left transition hover:border-emerald-400/40 hover:-translate-y-1 hover:shadow-lg"
                  >
                    <div className="flex h-40 items-center justify-center border-b border-slate-800 bg-slate-950/40">
                      {isImage ? (
                        <img
                          src={secureUrl}
                          alt={file.originalname}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="rounded-lg border border-slate-700 px-4 py-3 text-lg font-semibold text-slate-300">
                          {category.short}
                        </span>
                      )}
                    </div>

                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 truncate font-semibold text-white" title={file.originalname}>
                          {file.originalname}
                        </h3>
                        <span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                          {category.label}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-400">
                        {formatDate(file.createdAt)} · {formatFileSize(file.size)}
                      </p>
                    </div>
                  </motion.button>
                );
              })}
              </AnimatePresence>
            </motion.div>
          )}
        </motion.section>

        <FileActionModal
          key={selectedFile?._id || 'file-modal'}
          file={selectedFile}
          isOpen={Boolean(selectedFile)}
          onClose={() => setSelectedFile(null)}
          onUpdate={(...args) => updateFileName(...args)}
          onDelete={(...args) => deleteFile(...args)}
        />
      </motion.div>
    </DragDropZone>
  );
}
