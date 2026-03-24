import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
}

export function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  variant = 'danger',
}: ConfirmModalProps) {
  const iconBg =
    variant === 'danger' ? 'rgba(239,68,68,0.12)' : 'rgba(234,179,8,0.12)';
  const iconColor = variant === 'danger' ? 'var(--red)' : 'var(--yellow)';

  return (
    <Modal open={open} onClose={onCancel} className="max-w-[440px] w-[90%] p-7">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
        style={{ background: iconBg }}
      >
        <AlertTriangle size={22} style={{ color: iconColor }} />
      </div>
      <h3 className="text-lg text-text-bright mb-2">{title}</h3>
      <p className="text-sm text-text-dim leading-relaxed mb-6">{message}</p>
      <div className="flex gap-2.5 justify-end">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'warn'}
          onClick={() => {
            onConfirm();
            onCancel();
          }}
          className={
            variant === 'danger'
              ? '!bg-red !border-red !text-white hover:!bg-[#e03131] hover:!border-[#e03131]'
              : ''
          }
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
