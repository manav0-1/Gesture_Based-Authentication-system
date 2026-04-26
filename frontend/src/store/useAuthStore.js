import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASES } from '../utils/api';

const API_BASE = API_BASES.auth;
const BACKEND_UNREACHABLE_MESSAGE = 'Cannot reach the backend server. Start the API on port 5000 and try again.';

function createCorrelationId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createApiError(message, extras = {}) {
  const error = new Error(message);
  Object.assign(error, extras);
  return error;
}

function getNetworkErrorMessage(err) {
  if (err && typeof err === 'object' && 'status' in err && [502, 503, 504].includes(err.status)) {
    return BACKEND_UNREACHABLE_MESSAGE;
  }

  if (err instanceof TypeError && err.message === 'Failed to fetch') {
    return BACKEND_UNREACHABLE_MESSAGE;
  }

  return err.message || 'Request failed';
}

async function parseApiResponse(res) {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return res.json();
  }

  const text = await res.text();
  return text ? { message: text } : {};
}

async function apiRequest(path, { method = 'GET', body, token } = {}) {
  try {
    const headers = {
      'X-Correlation-ID': createCorrelationId(),
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const data = await parseApiResponse(res);

    if (!res.ok) {
      const retryAfter = Number(data.retryAfter ?? res.headers.get('retry-after'));
      throw createApiError(data.message || 'Request failed', {
        status: res.status,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }

    return data;
  } catch (err) {
    if (err instanceof Error) {
      throw createApiError(getNetworkErrorMessage(err), {
        status: err.status,
        retryAfter: err.retryAfter,
      });
    }

    throw createApiError('Request failed');
  }
}

// Token refresh timer
let refreshTimer = null;

const useAuthStore = create(
  persist(
    (set, get) => ({
      // State
      activeStep: 0,
      formData: { username: '', email: '', password: '', confirmPassword: '' },
      mouseGesture: null,
      handGesture: null,
      gestureMode: 'hand', // 'hand' or 'mouse'
      error: '',
      success: '',
      token: null,
      refreshToken: null,
      user: null,
      isLoading: false,
      isAuthenticated: false,
      nonce: null, // Anti-replay nonce
      backupCodes: [], // Shown once on registration
      gestureFeedback: null, // Real-time feedback
      gestureQuality: { score: 0, suggestions: [] },

      // Setters
      setActiveStep: (step) => set({ activeStep: step }),
      setFormField: (name, value) => set((state) => ({
        formData: { ...state.formData, [name]: value }
      })),
      setMouseGesture: (data) => set({ mouseGesture: data }),
      setHandGesture: (data) => set({ handGesture: data }),
      setGestureMode: (mode) => set({ gestureMode: mode }),
      setError: (msg) => set({ error: msg, success: '' }),
      setSuccess: (msg) => set({ success: msg, error: '' }),
      clearMessages: () => set({ error: '', success: '' }),
      setGestureFeedback: (feedback) => set({ gestureFeedback: feedback }),
      setGestureQuality: (quality) => set({ gestureQuality: quality }),

      // Navigation
      nextStep: () => {
        const { activeStep } = get();
        set({ activeStep: Math.min(activeStep + 1, 1), error: '' });
      },
      prevStep: () => {
        const { activeStep } = get();
        set({ activeStep: Math.max(activeStep - 1, 0), error: '' });
      },

      // Reset
      resetForm: () => set({
        activeStep: 0,
        formData: { username: '', email: '', password: '', confirmPassword: '' },
        mouseGesture: null,
        handGesture: null,
        error: '',
        success: '',
        isLoading: false,
        nonce: null,
        gestureFeedback: null,
        gestureQuality: { score: 0, suggestions: [] },
      }),

      // Schedule token refresh
      scheduleTokenRefresh: (expiresIn) => {
        if (refreshTimer) clearTimeout(refreshTimer);
        
        // Refresh 1 minute before expiry
        const refreshDelay = (expiresIn - 60) * 1000;
        if (refreshDelay > 0) {
          refreshTimer = setTimeout(() => {
            get().refreshAccessToken();
          }, refreshDelay);
        }
      },

      // Clear scheduled refresh
      clearTokenRefresh: () => {
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
      },

      // API: Refresh Access Token
      refreshAccessToken: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          set({ isAuthenticated: false, token: null });
          return false;
        }

        const attemptRefresh = async (retryToken) => {
          const data = await apiRequest('/refresh', {
            method: 'POST',
            body: { refreshToken: retryToken }
          });

          set({ 
            token: data.accessToken, 
            refreshToken: data.refreshToken,
            isAuthenticated: true 
          });
          
          get().scheduleTokenRefresh(data.expiresIn);
          return true;
        };

        try {
          return await attemptRefresh(refreshToken);
        } catch (err) {
          // On transient conflict, retry once with a short delay
          if (err.status === 401 && get().refreshToken) {
            try {
              await new Promise((r) => setTimeout(r, 500));
              const latestToken = get().refreshToken;
              if (latestToken && latestToken !== refreshToken) {
                return await attemptRefresh(latestToken);
              }
            } catch {
              // fall through to logout
            }
          }
          console.error('Token refresh failed:', err);
          set({ isAuthenticated: false, token: null, refreshToken: null, user: null });
          return false;
        }
      },

      // API: Register
      register: async () => {
        const { formData, mouseGesture, handGesture } = get();
        if (!mouseGesture) return set({ error: 'Please draw a mouse gesture first' });
        if (!handGesture) return set({ error: 'Please record a hand gesture first' });

        set({ isLoading: true, error: '' });
        try {
          // Add timestamp to prevent replay
          const gestureWithTimestamp = {
            points: mouseGesture,
            timestamp: Date.now()
          };

          const data = await apiRequest('/register', {
            method: 'POST',
            body: {
              username: formData.username,
              email: formData.email,
              password: formData.password,
              mouseGestureData: gestureWithTimestamp,
              handGestureLandmarks: handGesture
            }
          });
          
          // Store tokens
          set({ 
            token: data.accessToken,
            refreshToken: data.refreshToken,
            backupCodes: data.backupCodes || [],
            isAuthenticated: true,
            success: 'Registration successful! Save your backup codes.',
            isLoading: false 
          });
          
          get().scheduleTokenRefresh(data.expiresIn);
          return true;
        } catch (err) {
          set({ error: err.message || 'Registration failed', isLoading: false });
          return false;
        }
      },

      // API: Verify Credentials (Step 1) - Get nonce
      verifyCredentials: async () => {
        const { formData } = get();
        set({ isLoading: true, error: '' });
        try {
          const data = await apiRequest('/verify-credentials', {
            method: 'POST',
            body: {
              username: formData.username,
              email: formData.email,
              password: formData.password
            }
          });
          
          // Store nonce for gesture step
          set({ nonce: data.nonce, isLoading: false });
          return true;
        } catch (err) {
          set({ error: err.message || 'Invalid credentials', isLoading: false });
          return false;
        }
      },

      // API: Login with gesture
      login: async () => {
        const { formData, mouseGesture, handGesture, nonce } = get();
        
        if (!nonce) return set({ error: 'Please verify credentials first' });
        if (!mouseGesture && !handGesture) {
          return set({ error: 'Please draw a mouse gesture or record a hand gesture' });
        }

        set({ isLoading: true, error: '' });
        try {
          const payload = {
            username: formData.username || undefined,
            email: formData.email || undefined,
            password: formData.password,
            nonce: nonce, // Anti-replay
          };

          if (handGesture) {
            payload.handGestureLandmarks = handGesture;
          } else if (mouseGesture) {
            payload.mouseGestureData = {
              points: mouseGesture,
              timestamp: Date.now()
            };
          }

          const data = await apiRequest('/login', {
            method: 'POST',
            body: payload
          });

          set({ 
            token: data.accessToken,
            refreshToken: data.refreshToken,
            isAuthenticated: true,
            success: `Login successful! (${data.method} gesture matched at ${(data.similarity * 100).toFixed(1)}% via ${data.verification || 'gesture-check'})`,
            isLoading: false 
          });
          
          get().scheduleTokenRefresh(data.expiresIn);
          return true;
        } catch (err) {
          set({ error: err.message || 'Login failed', isLoading: false });
          return false;
        }
      },

      // API: Login with backup code
      loginWithBackupCode: async (backupCode) => {
        const { formData } = get();
        set({ isLoading: true, error: '' });
        
        try {
          const data = await apiRequest('/backup-code', {
            method: 'POST',
            body: {
              username: formData.username,
              backupCode: backupCode.toUpperCase()
            }
          });

          set({ 
            token: data.accessToken,
            refreshToken: data.refreshToken,
            isAuthenticated: true,
            success: `Login successful! (${data.remainingBackupCodes} backup codes remaining)`,
            isLoading: false 
          });
          
          get().scheduleTokenRefresh(data.expiresIn);
          return true;
        } catch (err) {
          set({ error: err.message || 'Invalid backup code', isLoading: false });
          return false;
        }
      },

      // API: Request OTP
      requestOTP: async (email) => {
        set({ isLoading: true, error: '' });
        try {
          const data = await apiRequest('/request-otp', {
            method: 'POST',
            body: { email }
          });
          
          set({ success: 'OTP sent to your email!', isLoading: false });
          return {
            ok: true,
            ...data,
            retryAfter: 60,
          };
        } catch (err) {
          set({ error: err.message || 'Failed to send OTP', isLoading: false });
          return {
            ok: false,
            retryAfter: err.retryAfter,
          };
        }
      },

      // API: Verify OTP
      verifyOTP: async (email, otp) => {
        set({ isLoading: true, error: '' });
        try {
          await apiRequest('/verify-otp', {
            method: 'POST',
            body: { email, otp }
          });
          set({ success: 'Email verified successfully!', isLoading: false });
          return true;
        } catch (err) {
          set({ error: err.message || 'Invalid OTP', isLoading: false });
          return false;
        }
      },

      // API: Logout
      logout: async () => {
        const { refreshToken } = get();
        
        // Call logout endpoint to revoke refresh token
        if (refreshToken) {
          try {
            await apiRequest('/logout', {
              method: 'POST',
              body: { refreshToken }
            });
          } catch (err) {
            console.error('Logout API error:', err);
          }
        }
        
        get().clearTokenRefresh();
        set({ 
          token: null, 
          refreshToken: null,
          isAuthenticated: false,
          user: null,
          backupCodes: []
        });
      },

      // API: Logout all sessions
      logoutAll: async () => {
        const { token } = get();
        
        try {
          await apiRequest('/logout-all', {
            method: 'POST',
            token
          });
        } catch (err) {
          console.error('Logout all error:', err);
        }
        
        get().logout();
      },

      // Check auth status on app load
      checkAuth: async () => {
        const { token, refreshToken } = get();
        
        if (!token && !refreshToken) {
          set({ isAuthenticated: false });
          return false;
        }

        // Try to refresh if we have a refresh token
        if (refreshToken) {
          const refreshed = await get().refreshAccessToken();
          return refreshed;
        }

        return false;
      }
    }),
    {
      name: 'gesture-auth-storage',
      partialize: (state) => ({ 
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
);

export default useAuthStore;
