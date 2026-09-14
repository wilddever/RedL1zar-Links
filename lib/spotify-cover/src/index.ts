import { useEffect, useRef, useState } from 'react';

export const DEFAULT_SPOTIFY_COVER_LOAD_TIMEOUT_MS = 6_000;

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
  const coverTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const clearCoverTimeout = () => {
      if (coverTimeoutRef.current !== null) {
        window.clearTimeout(coverTimeoutRef.current);
        coverTimeoutRef.current = null;
      }
    };

    setFailed(false);
    clearCoverTimeout();

    if (coverUrl) {
      coverTimeoutRef.current = window.setTimeout(() => {
        setFailed(true);
        coverTimeoutRef.current = null;
      }, timeoutMs);
    }

    return () => {
      clearCoverTimeout();
    };
  }, [coverUrl, timeoutMs]);

  const handleError = () => {
    if (coverTimeoutRef.current !== null) {
      window.clearTimeout(coverTimeoutRef.current);
      coverTimeoutRef.current = null;
    }
    setFailed(true);
  };

  const handleLoad = () => {
    if (coverTimeoutRef.current !== null) {
      window.clearTimeout(coverTimeoutRef.current);
      coverTimeoutRef.current = null;
    }
    setFailed(false);
  };

  return {
    imageUrl: coverUrl && !failed ? coverUrl : null,
    failed,
    handleError,
    handleLoad,
  };
}