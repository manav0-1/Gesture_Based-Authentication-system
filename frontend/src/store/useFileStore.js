import { create } from 'zustand';
import useAuthStore from './useAuthStore';
import { API_BASES } from '../utils/api';

const API_BASE = API_BASES.files;

const fetchWithAuth = async (url, options = {}) => {
  const token = useAuthStore.getState().token;
  if (!token) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'API request failed');
  }
  return res;
};

const useFileStore = create((set, get) => ({
  files: [],
  isLoading: false,
  error: '',
  success: '',

  clearMessages: () => set({ error: '', success: '' }),

  fetchFiles: async () => {
    set({ isLoading: true, error: '' });
    try {
      const res = await fetchWithAuth('');
      const data = await res.json();
      set({ files: data, isLoading: false });
    } catch (err) {
      set({ error: err.message || 'Failed to fetch files', isLoading: false });
    }
  },

  uploadFile: async (file) => {
    set({ isLoading: true, error: '' });
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Note: Do not set Content-Type for FormData, the browser will set it automatically with the boundary
      const res = await fetchWithAuth('', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      set((state) => ({ 
        files: [data, ...state.files],
        success: 'File uploaded securely!',
        isLoading: false 
      }));
      
      setTimeout(() => get().clearMessages(), 3000);
      return true;
    } catch (err) {
      set({ error: err.message || 'Upload failed', isLoading: false });
      return false;
    }
  },

  updateFileName: async (id, newName) => {
    set({ isLoading: true, error: '' });
    try {
      const res = await fetchWithAuth(`/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName })
      });
      const data = await res.json();
      
      set((state) => ({
        files: state.files.map(f => f._id === id ? data : f),
        success: 'File renamed successfully!',
        isLoading: false
      }));

      setTimeout(() => get().clearMessages(), 3000);
      return true;
    } catch (err) {
      set({ error: err.message || 'Failed to rename file', isLoading: false });
      return false;
    }
  },

  deleteFile: async (id) => {
    set({ isLoading: true, error: '' });
    try {
      await fetchWithAuth(`/${id}`, { method: 'DELETE' });
      set((state) => ({
        files: state.files.filter(f => f._id !== id),
        success: 'File deleted permanently.',
        isLoading: false
      }));

      setTimeout(() => get().clearMessages(), 3000);
      return true;
    } catch (err) {
      set({ error: err.message || 'Failed to delete file', isLoading: false });
      return false;
    }
  }
}));

export default useFileStore;
