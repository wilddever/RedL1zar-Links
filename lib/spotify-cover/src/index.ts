import { useEffect, useRef, useState } from 'react';

export const DEFAULT_SPOTIFY_COVER_LOAD_TIMEOUT_MS = 6_000;

export interface SpotifyCoverState {
  objectUrl: string | null;
  failed: boolean;
  handleError: () => void;
  handleLoad: () => void;
}

export function useSpotifyCoverObjectUrl(
  coverUrl: string | null,
  timeoutMs = DEFAULT_SPOTIFY_COVER_LOAD_TIMEOUT_MS,
): SpotifyCoverState {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const coverTimeoutRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const clearCoverTimeout = () => {
      if (coverTimeoutRef.current !== null) {
        window.clearTimeout(coverTimeoutRef.current);
        coverTimeoutRef.current = null;
      }
    };

    const releaseObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    setObjectUrl(null);
    setFailed(false);
    clearCoverTimeout();
    releaseObjectUrl();

    if (coverUrl) {
      coverTimeoutRef.current = window.setTimeout(() => {
        controller.abort();
        setFailed(true);
        setObjectUrl(null);
        coverTimeoutRef.current = null;
      }, timeoutMs);

      fetch(coverUrl, { cache: 'force-cache', signal: controller.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Spotify cover request failed: ${response.status}`);
          }
          return response.blob();
        })
        .then((blob) => {
          if (!active) return;
          const nextObjectUrl = URL.createObjectURL(blob);
          objectUrlRef.current = nextObjectUrl;
          clearCoverTimeout();
          setObjectUrl(nextObjectUrl);
        })
        .catch(() => {
          if (!active) return;
          clearCoverTimeout();
          setFailed(true);
        });
    }

    return () => {
      active = false;
      controller.abort();
      clearCoverTimeout();
      releaseObjectUrl();
    };
  }, [coverUrl, timeoutMs]);

  const handleError = () => {
    if (coverTimeoutRef.current !== null) {
      window.clearTimeout(coverTimeoutRef.current);
      coverTimeoutRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setObjectUrl(null);
    setFailed(true);
  };

  const handleLoad = () => {
    if (coverTimeoutRef.current !== null) {
      window.clearTimeout(coverTimeoutRef.current);
      coverTimeoutRef.current = null;
    }
  };

  return {
    objectUrl,
    failed,
    handleError,
    handleLoad,
  };
}