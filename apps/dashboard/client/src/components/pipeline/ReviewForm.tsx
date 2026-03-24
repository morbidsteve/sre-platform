import React, { useState } from 'react';
import { Button } from '../ui/Button';

interface ReviewFormProps {
  onSubmit: (decision: 'approved' | 'rejected' | 'returned', comment: string) => void;
  loading?: boolean;
}

export function ReviewForm({ onSubmit, loading = false }: ReviewFormProps) {
  const [decision, setDecision] = useState<'approved' | 'rejected' | 'returned' | ''>('');
  const [comment, setComment] = useState('');

  const handleSubmit = () => {
    if (!decision) {
      alert('Please select a decision');
      return;
    }
    if ((decision === 'rejected' || decision === 'returned') && !comment.trim()) {
      alert('Comment is required for reject/return');
      return;
    }
    onSubmit(decision, comment);
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-surface">
      <h3 className="text-sm font-semibold text-text-primary mb-3">ISSM Review Decision</h3>

      <div className="flex flex-col gap-2 mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="review-decision"
            value="approved"
            checked={decision === 'approved'}
            onChange={() => setDecision('approved')}
          />
          <span className="text-sm text-green font-semibold">Approve</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="review-decision"
            value="rejected"
            checked={decision === 'rejected'}
            onChange={() => setDecision('rejected')}
          />
          <span className="text-sm text-red font-semibold">Reject</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="review-decision"
            value="returned"
            checked={decision === 'returned'}
            onChange={() => setDecision('returned')}
          />
          <span className="text-sm text-yellow font-semibold">Return for Rework</span>
        </label>
      </div>

      <div className="mb-4">
        <label className="text-xs text-text-dim block mb-1">
          Comment {decision !== 'approved' ? '(required)' : '(optional)'}
        </label>
        <textarea
          className="form-input !mb-0 min-h-[80px] resize-y"
          placeholder="Enter review comments..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Button variant="primary" onClick={handleSubmit} disabled={loading || !decision}>
          {loading ? 'Submitting...' : 'Submit Review'}
        </Button>
      </div>
    </div>
  );
}
