import { createContext, useContext, useState, useCallback } from 'react';

interface ModalOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ModalState {
  isOpen: boolean;
  title: string;
  message: string;
  options: ModalOptions;
  onConfirm: () => void;
}

interface ModalContextValue {
  confirm: (title: string, message: string, onConfirm: () => void, options?: ModalOptions) => void;
}

const ModalContext = createContext<ModalContextValue>({
  confirm: () => {},
});

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<ModalState>({
    isOpen: false,
    title: '',
    message: '',
    options: {},
    onConfirm: () => {},
  });

  const confirm = useCallback(
    (title: string, message: string, onConfirm: () => void, options?: ModalOptions) => {
      setModal({ isOpen: true, title, message, options: options || {}, onConfirm });
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    modal.onConfirm();
    setModal((prev) => ({ ...prev, isOpen: false }));
  }, [modal]);

  const handleCancel = useCallback(() => {
    setModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <ModalContext.Provider value={{ confirm }}>
      {children}
      {modal.isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={handleCancel}
        >
          <div
            style={{
              background: 'var(--card)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 420,
              width: '90%',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              border: '1px solid var(--border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{modal.title}</h3>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.5 }}>
              {modal.message}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn"
                onClick={handleCancel}
                style={{ fontSize: 13 }}
              >
                {modal.options.cancelLabel || 'Cancel'}
              </button>
              <button
                className={modal.options.danger ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={handleConfirm}
                style={{ fontSize: 13 }}
              >
                {modal.options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalContextValue {
  return useContext(ModalContext);
}
