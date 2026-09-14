import { useEffect, useRef, useState } from 'react';

export const DEFAULT_SPOTIFY_COVER_LOAD_TIMEOUT_MS = 6_000;
const MAX_SPOTIFY_COVER_ATTEMPTS = 2;

export interface SpotifyCoverState {
  imageUrl: string | null;
  failed: boolean;
  handleError: () => void;
  handleLoad: () => void;
}

export function useSpotifyCover(
  coverUrl: string | null,
  timeoutMs = DEFAULT_SPOTIFY_COVER_LOAD_TIMEOUT_MS,
): SpotifyCoverState {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [lastGoodUrl, setLastGoodUrl] = useState<string | null>(null);
  const coverTimeoutRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  function retryOrFail() {
    if (coverTimeoutRef.current !== null) {
      window.clearTimeout(coverTimeoutRef.current);
      coverTimeoutRef.current = null;
    }

    if (coverUrl && attemptRef.current < MAX_SPOTIFY_COVER_ATTEMPTS) {
      attemptRef.current += 1;
      setAttempt(attemptRef.current);
      setFailed(false);
      coverTimeoutRef.current = window.setTimeout(retryOrFail, timeoutMs);
      return;
    }

    setFailed(true);
  }

  useEffect(() => {
    const clearCoverTimeout = () => {
      if (coverTimeoutRef.current !== null) {
        window.clearTimeout(coverTimeoutRef.current);
        coverTimeoutRef.current = null;
      }
    };

    setFailed(false);
    attemptRef.current = 0;
    setAttempt(0);
    clearCoverTimeout();

    if (coverUrl) {
      coverTimeoutRef.current = window.setTimeout(retryOrFail, timeoutMs);
    }

    return () => {
      clearCoverTimeout();
    };
  }, [coverUrl, timeoutMs]);

  const handleError = () => {
    retryOrFail();
  };

  const handleLoad = () => {
    if (coverTimeoutRef.current !== null) {
      window.clearTimeout(coverTimeoutRef.current);
      coverTimeoutRef.current = null;
    }
    if (coverUrl) {
      setLastGoodUrl(coverUrl);
    }
    attemptRef.current = 0;
    setAttempt(0);
    setFailed(false);
  };

  const requestUrl =
    coverUrl && attempt > 0
      ? `${coverUrl}${coverUrl.includes('?') ? '&' : '?'}attempt=${attempt}`
      : coverUrl;

  return {
    imageUrl: failed ? lastGoodUrl : requestUrl,
    failed,
    handleError,
    handleLoad,
  };
}