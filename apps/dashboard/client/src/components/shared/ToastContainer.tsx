import React from 'react';
import { useToast } from '../../context/ToastContext';

export function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[2000] flex flex-col gap-2">
      {toasts.map((toast) => {
        let borderColor = 'var(--border)';
        let bgColor = 'var(--card)';
        let textColor = 'var(--text)';

        if (toast.type === 'error') {
          borderColor = 'rgba(239,68,68,0.3)';
          bgColor = 'rgba(239,68,68,0.1)';
          textColor = 'var(--red)';
        } else if (toast.type === 'warning') {
          borderColor = 'rgba(234,179,8,0.3)';
          bgColor = 'rgba(234,179,8,0.1)';
          textColor = 'var(--yellow)';
        } else if (toast.type === 'success') {
          borderColor = 'rgba(34,197,94,0.3)';
          bgColor = 'rgba(34,197,94,0.1)';
          textColor = 'var(--green)';
        }

        return (
          <div
            key={toast.id}
            className="rounded px-4 py-3 text-[13px] cursor-pointer max-w-[360px] animate-toast-in"
            style={{
              background: bgColor,
              border: `1px solid ${borderColor}`,
              color: textColor,
              boxShadow: 'var(--shadow)',
            }}
            onClick={() => dismissToast(toast.id)}
          >
            {toast.message}
          </div>
        );
      })}
    </div>
  );
}
