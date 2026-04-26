const API_ROOT = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

export const API_BASES = {
  auth: `${API_ROOT}/auth`,
  files: `${API_ROOT}/files`,
};

export function buildFileViewUrl(fileId, token) {
  const url = new URL(`${API_BASES.files}/view/${fileId}`, window.location.origin);

  if (token) {
    url.searchParams.set('token', token);
  }

  return url.toString();
}
