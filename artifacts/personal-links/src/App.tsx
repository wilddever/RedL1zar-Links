import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { SiPinterest, SiSpotify, SiSteam, SiTelegram } from 'react-icons/si';
import {
  getCurrentSpotifyTrack,
  type SpotifyCurrentlyPlaying,
} from '@workspace/api-client-react';

const platforms = [
  {
    name: 'Steam',
    handle: 'steamcommunity / RedL1zar',
    href: 'https://steamcommunity.com/id/RedL1zar/',
    icon: SiSteam,
  },
  {
    name: 'Pinterest',
    handle: 'pin.it / 6Ni8NpFtk',
    href: 'https://pin.it/6Ni8NpFtk',
    icon: SiPinterest,
  },
  {
    name: 'Spotify',
    handle: 'spotify / RedL1zar',
    href: 'https://open.spotify.com/user/31qwvdcqd7w5laybiacxk2lrgzr4',
    icon: SiSpotify,
  },
  {
    name: 'Telegram',
    handle: 't.me / RedL1zar',
    href: 'https://t.me/RedL1zar',
    icon: SiTelegram,
  },
  {
    name: 'Риса За Творчество',
    handle: 'risazatvorchestvo.com / user / 47275',
    href: 'https://risazatvorchestvo.com/user/47275',
    icon: ExternalLink,
  },
];

const spotifyImageHosts = new Set([
  'i.scdn.co',
  'mosaic.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
]);

function getSpotifyCoverUrl(imageUrl: string): string {
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== 'https:' || !spotifyImageHosts.has(url.hostname)) {
      return imageUrl;
    }
    return `/api/spotify/cover?url=${encodeURIComponent(url.toString())}`;
  } catch {
    return imageUrl;
  }
}

function Home() {
  const [copied, setCopied] = useState(false);

  const copyHandle = async () => {
    try {
      await navigator.clipboard.writeText('@RedL1zar');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="page-shell">
      <div className="content-frame">
        <header className="topbar">
          <div className="brand-mark" data-testid="text-brand-mark">
            <span className="brand-dot" aria-hidden="true" />
            RL / 001
          </div>
          <div className="availability mono-label" data-testid="status-availability">
            <i aria-hidden="true" />
            somewhere online
          </div>
        </header>

        <section className="hero" aria-labelledby="profile-title">
          <div className="hero-copy">
            <div className="eyebrow mono-label">personal frequency</div>
            <h1 id="profile-title" data-testid="text-profile-name">
              RedL1zar
              <span>you found the signal.</span>
            </h1>
            <p className="hero-description" data-testid="text-welcome">
              A small corner of the internet for things I play, save, listen to,
              and send into the void.
            </p>
          </div>
        </section>

        <NowPlaying />

        <section className="links-section" aria-labelledby="links-title">
          <div className="links-header">
            <h2 id="links-title">Find me in other places</h2>
            <span className="mono-label">05 channels</span>
          </div>
          <div className="link-list">
            {platforms.map(({ name, handle, href, icon: Icon }, index) => (
              <a
                className="platform-link"
                data-testid={`link-platform-${name.toLowerCase()}`}
                href={href}
                key={name}
                rel="noreferrer"
                target="_blank"
              >
                <span className="platform-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span>
                  <span className="platform-name">{name}</span>
                  <span className="platform-handle">
                    {String(index + 1).padStart(2, '0')} / {handle}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>

        <footer className="footer-bar">
          <span className="mono-label" data-testid="text-footer">
            built for wandering / © RedL1zar
          </span>
           <div className="footer-actions">
             <button
               className="copy-button"
               data-testid="button-copy-handle"
               onClick={copyHandle}
               type="button"
             >
               {copied ? 'handle copied' : 'copy @RedL1zar'}
             </button>
           </div>
        </footer>
      </div>
    </main>
  );
}

function NowPlaying() {
  const [state, setState] = useState<SpotifyCurrentlyPlaying | null>(null);

  useEffect(() => {
    let mounted = true;
    let requestInFlight = false;

    const loadCurrentTrack = async () => {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const nextState = await getCurrentSpotifyTrack();
        if (mounted) setState(nextState);
      } catch {
        if (mounted) {
          setState({
            status: 'unavailable',
            track: null,
            message: 'Spotify временно недоступен',
          });
        }
      } finally {
        requestInFlight = false;
      }
    };

    void loadCurrentTrack();
    const intervalId = window.setInterval(loadCurrentTrack, 15_000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const track = state?.track;
  const statusLabel =
    state?.status === 'playing'
      ? 'now playing'
      : state?.status === 'paused'
        ? 'paused'
        : 'spotify signal';

  return (
    <section
      className={`now-playing-section ${track ? 'now-playing-section--active' : ''}`}
      aria-labelledby="now-playing-title"
      aria-live="polite"
      data-testid="section-now-playing"
    >
      <div className="now-playing-header">
        <div>
          <div className="eyebrow mono-label">soundcheck</div>
          <h2 id="now-playing-title">Listening now</h2>
        </div>
        <span className="mono-label now-playing-status">{statusLabel}</span>
      </div>

      {track ? (
        <a
          className="now-playing-card"
          data-testid="link-current-track"
          href={track.spotifyUrl}
          rel="noreferrer"
          target="_blank"
        >
          {track.imageUrl ? (
            <img
              className="now-playing-art"
                src={getSpotifyCoverUrl(track.imageUrl)}
              alt={`Обложка альбома «${track.album}»`}
            />
          ) : (
            <span className="now-playing-art now-playing-art--empty" aria-hidden="true">
              <SiSpotify />
            </span>
          )}
          <span className="now-playing-copy">
            <span className="now-playing-message">{state.message}</span>
            <strong>{track.title}</strong>
            <span>{track.artist}</span>
            <small>{track.album}</small>
          </span>
          <span className="now-playing-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
      ) : (
        <div className="now-playing-empty" data-testid="status-current-track">
          <span className="now-playing-empty-icon" aria-hidden="true">
            <SiSpotify />
          </span>
          <span>{state?.message ?? 'Проверяем Spotify…'}</span>
        </div>
      )}
    </section>
  );
}

export default Home;
