import { useState, useCallback } from 'react';
import { requestSecurityExceptions as apiRequestSecurityExceptions } from '../api';

/** Detected exception from pipeline metadata */
export interface DetectedException {
  type: string;
  reason: string;
}

/**
 * Hook for managing security exception requests.
 * Detects when the pipeline finds apps needing elevated privileges
 * and lets users request exceptions with justification.
 */
export function useSecurityExceptions() {
  const [exceptionJustification, setExceptionJustification] = useState('');
  const [exceptionRequested, setExceptionRequested] = useState(false);
  const [exceptionError, setExceptionError] = useState<string | null>(null);
  const [requestingException, setRequestingException] = useState(false);

  const requestException = useCallback(async (
    pipelineRunId: string,
    exceptionType: string,
    justification: string
  ) => {
    if (!pipelineRunId || !justification.trim()) return;
    setRequestingException(true);
    setExceptionError(null);
    try {
      await apiRequestSecurityExceptions(pipelineRunId, [
        { type: exceptionType, justification },
      ]);
      setExceptionRequested(true);
    } catch (err) {
      setExceptionError(
        err instanceof Error ? err.message : 'Failed to request security exception'
      );
    } finally {
      setRequestingException(false);
    }
  }, []);

  const resetExceptions = useCallback(() => {
    setExceptionJustification('');
    setExceptionRequested(false);
    setExceptionError(null);
    setRequestingException(false);
  }, []);

  return {
    exceptionJustification,
    setExceptionJustification,
    exceptionRequested,
    exceptionError,
    requestingException,
    requestException,
    resetExceptions,
  };
}
