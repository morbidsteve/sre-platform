import { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  dismissing: boolean;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  showToast: () => {},
  dismissToast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const removeToast = useCallback((id: number) => {
    // Set dismissing state, then remove after animation
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, dismissing: true } : t));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type, dismissing: false }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  const dismissToast = useCallback((id: number) => {
    removeToast(id);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast-${toast.type}`}
              onClick={() => dismissToast(toast.id)}
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                fontSize: 13,
                color: '#fff',
                cursor: 'pointer',
                background:
                  toast.type === 'error'
                    ? '#ef4444'
                    : toast.type === 'warning'
                      ? '#f59e0b'
                      : toast.type === 'success'
                        ? '#22c55e'
                        : '#6366f1',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                animation: toast.dismissing
                  ? 'fadeSlideDown 0.2s ease-in forwards'
                  : 'fadeIn 0.2s ease-out',
                maxWidth: 400,
                wordBreak: 'break-word',
              }}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
