import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { CalendarPlus, ExternalLink } from 'lucide-react';
import { SiPinterest, SiSpotify, SiSteam, SiTelegram } from 'react-icons/si';
import {
  getCurrentSteamGame,
  getCurrentSpotifyTrack,
  apiUrl,
  spotifyCoverApiUrl,
  type SteamCurrentlyPlaying,
  type SpotifyCurrentlyPlaying,
} from '@workspace/api-client-react';
import { useSpotifyCover } from '@workspace/spotify-cover';
import rztLogo from '../attached_assets/photo_2026-01-18_13-43-45_1789144600817.jpg';
import roadSign from '../attached_assets/Picsart_26-09-11_21-29-09-376_1789144606943.png';
import yandexMusicLogo from '../attached_assets/изображение_1789152023645.png';
import SecretSheepGame from './SecretSheepGame';

const platforms = [
  {
    name: 'Steam',
    handle: 'steamcommunity / RedL1zar',
    href: 'https://steamcommunity.com/id/RedL1zar/',
    icon: SiSteam,
    logo: null,
  },
  {
    name: 'Pinterest',
    handle: 'pin.it / 6Ni8NpFtk',
    href: 'https://pin.it/6Ni8NpFtk',
    icon: SiPinterest,
    logo: null,
  },
  {
    name: 'Spotify',
    handle: 'spotify / RedL1zar',
    href: 'https://open.spotify.com/user/31qwvdcqd7w5laybiacxk2lrgzr4',
    icon: SiSpotify,
    logo: null,
  },
  {
    name: 'Telegram',
    handle: 't.me / RedL1zar',
    href: 'https://t.me/RedL1zar',
    icon: SiTelegram,
    logo: null,
  },
  {
    name: 'Риса За Творчество',
    handle: 'risazatvorchestvo.com / user / 47275',
    href: 'https://risazatvorchestvo.com/user/47275',
    icon: ExternalLink,
    logo: rztLogo,
  },
];

const playlists = [
  {
    name: 'my main 4',
    number: '04',
    spotifyHref:
      'https://open.spotify.com/playlist/3IX8KjGxQz4LXFEreDds4d?si=aca09cc518eb4031',
    yandexHref:
      'https://music.yandex.ru/playlists/6d52d453-eadd-62f5-be2c-c2ca05328bfc?utm_medium=copy_link&ref_id=6041e177-8841-4cd7-b871-0a768343d1af',
  },
  {
    name: 'my main 5',
    number: '05',
    spotifyHref:
      'https://open.spotify.com/playlist/294LgC3ikrANB7hVY6b3OM?si=3808989918d74ce1',
    yandexHref:
      'https://music.yandex.ru/playlists/685380f9-5d00-e4f0-b4ac-a2a4878c87f9?utm_medium=copy_link&ref_id=519b1691-d903-4e13-90d3-e64d47dee138',
  },
];

const YANDEX_404_URL = 'https://music.yandex.ru/404';

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
    return spotifyCoverApiUrl(
      `/api/spotify/cover?url=${encodeURIComponent(url.toString())}`,
    );
  } catch {
    return imageUrl;
  }
}

const previewTracks: SpotifyCurrentlyPlaying[] = [
  {
    status: 'playing',
    track: {
      title: 'Midnight Signal',
      artist: 'Preview FM',
      album: 'Local Broadcast',
      imageUrl: null,
      spotifyUrl: 'https://open.spotify.com/',
    },
    message: 'Preview loop / demo signal',
  },
  {
    status: 'playing',
    track: {
      title: 'Field Notes',
      artist: 'RedL1zar Radio',
      album: 'Somewhere Online',
      imageUrl: null,
      spotifyUrl: 'https://open.spotify.com/',
    },
    message: 'Preview loop / demo signal',
  },
  {
    status: 'paused',
    track: {
      title: 'Signal Lost, Signal Found',
      artist: 'Night Drive Unit',
      album: 'Static Weather',
      imageUrl: null,
      spotifyUrl: 'https://open.spotify.com/',
    },
    message: 'Preview loop / demo signal',
  },
];

const chaosGlyphs =
  '∆∿⋮※⟟⧖⸮╳░▒▓⌁⌇⌗⌘⌬⌁⍉⎔⏣⨳⟡⧉⸸ꙮȝƛʭЖЖЖ';
const chaosNameLength = 7;

function preventImageContextMenu(event: MouseEvent<HTMLImageElement>) {
  event.preventDefault();
}

function getChaosGlyph() {
  return chaosGlyphs[Math.floor(Math.random() * chaosGlyphs.length)];
}

function getPreviewState(): SpotifyCurrentlyPlaying | null {
  if (!import.meta.env.DEV) return null;
  const index = Math.floor(Date.now() / 15_000) % previewTracks.length;
  return previewTracks[index];
}

function ChaoticName() {
  const [symbols, setSymbols] = useState(() =>
    Array.from({ length: chaosNameLength }, getChaosGlyph),
  );

  useEffect(() => {
    const timers = Array.from({ length: chaosNameLength }, (_, index) =>
      window.setInterval(() => {
        setSymbols((current) =>
          current.map((symbol, symbolIndex) =>
            symbolIndex === index ? getChaosGlyph() : symbol,
          ),
        );
      }, 75 + index * 17),
    );

    return () => timers.forEach((timer) => window.clearInterval(timer));
  }, []);

  return (
    <span className="chaos-name" aria-label="RedL1zar">
      {symbols.map((symbol, index) => (
        <span aria-hidden="true" className="chaos-name__symbol" key={index}>
          {symbol}
        </span>
      ))}
    </span>
  );
}

type View = 'home' | 'playlists' | 'birthday' | 'send';

function getViewFromLocation(): View {
  if (window.location.hash === '#playlists') return 'playlists';
  if (window.location.hash === '#birthday') return 'birthday';
  if (window.location.hash === '#send') return 'send';
  return 'home';
}

function SpotifyOwnerConnect() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const connectSpotify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('connecting');
    setErrorMessage('');

    try {
      const response = await fetch(apiUrl('/api/spotify/owner-auth-url'), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerToken: token }),
      });
      const result = (await response.json().catch(() => null)) as
        | { authorizationUrl?: string; message?: string }
        | null;

      if (!response.ok || !result?.authorizationUrl) {
        throw new Error(
          result?.message || `Ошибка авторизации (${response.status})`,
        );
      }

      setToken('');
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Не удалось начать подключение Spotify.',
      );
    }
  };

  return (
    <main className="page-shell">
      <div className="content-frame">
        <header className="topbar">
          <div className="brand-mark">
            <span className="brand-dot" aria-hidden="true" />
            RL / SPOTIFY
          </div>
          <a className="owner-connect-back" href="/">
            back
          </a>
        </header>

        <section className="owner-connect-section" aria-labelledby="owner-connect-title">
          <div className="eyebrow mono-label">private setup</div>
          <h1 id="owner-connect-title">Connect Spotify</h1>
          <p>
            Эта страница нужна только для первого подключения Spotify. Токен
            отправляется только в защищённый запрос и не сохраняется в браузере.
          </p>

          <form
            className="owner-connect-form"
            onSubmit={connectSpotify}
          >
            <label className="owner-connect-field">
              <span className="mono-label">owner token</span>
              <input
                autoComplete="off"
                autoFocus
                name="ownerToken"
                onChange={(event) => setToken(event.target.value)}
                placeholder="Вставьте owner token"
                required
                type="password"
                value={token}
              />
            </label>
            <button
              className="send-submit owner-connect-submit"
              disabled={status === 'connecting' || !token.trim()}
              type="submit"
            >
              {status === 'connecting' ? 'Проверяем…' : 'Подключить Spotify'}
            </button>
          </form>

          {status === 'error' ? (
            <p className="send-status send-status--error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function Home() {
  const [copied, setCopied] = useState(false);
  const [isSignWobbling, setIsSignWobbling] = useState(false);
  const [activeView, setActiveView] = useState<View>(getViewFromLocation);
  const [isSecretGameOpen, setIsSecretGameOpen] = useState(false);
  const signPressesRef = useRef(0);

  useEffect(() => {
    const syncViewWithLocation = () => setActiveView(getViewFromLocation());

    window.addEventListener('hashchange', syncViewWithLocation);
    window.addEventListener('popstate', syncViewWithLocation);

    return () => {
      window.removeEventListener('hashchange', syncViewWithLocation);
      window.removeEventListener('popstate', syncViewWithLocation);
    };
  }, []);

  if (new URLSearchParams(window.location.search).get('spotify') === 'owner') {
    return <SpotifyOwnerConnect />;
  }

  const navigateTo = (view: View) => {
    const nextHash =
      view === 'playlists'
        ? '#playlists'
        : view === 'birthday'
          ? '#birthday'
          : view === 'send'
            ? '#send'
            : '#home';
    if (window.location.hash !== nextHash) {
      window.history.pushState({}, '', nextHash);
    }
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const copyHandle = async () => {
    try {
      await navigator.clipboard.writeText('@RedL1zar');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleRoadSignClick = () => {
    setIsSignWobbling(false);
    window.requestAnimationFrame(() => setIsSignWobbling(true));

    signPressesRef.current += 1;
    if (signPressesRef.current < 7) return;

    signPressesRef.current = 0;
    window.history.replaceState({}, '', '#home');
    setIsSecretGameOpen(true);
  };

  if (isSecretGameOpen) return <SecretSheepGame />;

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

        <nav className="section-nav" aria-label="Site sections">
          <button
            aria-current={activeView === 'home' ? 'page' : undefined}
            className={`section-nav__tab ${activeView === 'home' ? 'section-nav__tab--active' : ''}`}
            data-testid="button-section-home"
            onClick={() => navigateTo('home')}
            type="button"
          >
            main
          </button>
          <button
            aria-current={activeView === 'playlists' ? 'page' : undefined}
            className={`section-nav__tab ${activeView === 'playlists' ? 'section-nav__tab--active' : ''}`}
            data-testid="button-section-playlists"
            onClick={() => navigateTo('playlists')}
            type="button"
          >
            playlists
          </button>
          <button
            aria-current={activeView === 'send' ? 'page' : undefined}
            className={`section-nav__tab ${activeView === 'send' ? 'section-nav__tab--active' : ''}`}
            data-testid="button-section-send"
            onClick={() => navigateTo('send')}
            type="button"
          >
            send
          </button>
          <button
            aria-current={activeView === 'birthday' ? 'page' : undefined}
            className={`section-nav__tab ${activeView === 'birthday' ? 'section-nav__tab--active' : ''}`}
            data-testid="button-section-birthday"
            onClick={() => navigateTo('birthday')}
            type="button"
          >
            birthday
          </button>
        </nav>

        {activeView === 'home' ? (
          <>
            <section className="hero" aria-labelledby="profile-title">
              <div className="hero-copy">
                <div className="eyebrow mono-label">personal frequency</div>
                <h1 id="profile-title" data-testid="text-profile-name">
                  RedL1zar
                  <span>you found the signal.</span>
                </h1>
                <p className="hero-description" data-testid="text-welcome">
                  hello. my name is <ChaoticName />, aka redl1zar. its a small
                  corner of the internet for things i play, listen to, and send into
                  the void
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
                {platforms.map(({ name, handle, href, icon: Icon, logo }, index) => (
                  <a
                    className="platform-link"
                    data-testid={`link-platform-${name.toLowerCase()}`}
                    href={href}
                    key={name}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="platform-icon" aria-hidden="true">
                      {logo ? (
                        <img
                          src={logo}
                          alt=""
                          draggable={false}
                          onContextMenu={preventImageContextMenu}
                        />
                      ) : (
                        <Icon />
                      )}
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
          </>
        ) : activeView === 'playlists' ? (
          <PlaylistsView />
        ) : activeView === 'birthday' ? (
          <BirthdayView />
        ) : (
          <SendView />
        )}

        <footer className="footer-bar">
          <span className="mono-label" data-testid="text-footer">
            built for wandering / © RedL1zar
          </span>
          <div className="road-sign-stage">
            <button
              aria-label="Покачать дорожный знак"
              className={`road-sign-button ${isSignWobbling ? 'road-sign-button--wobbling' : ''}`}
              onAnimationEnd={() => setIsSignWobbling(false)}
              onClick={handleRoadSignClick}
              type="button"
            >
              <img
                src={roadSign}
                alt="Дорожный знак с человеком за ноутбуком"
                draggable={false}
                onContextMenu={preventImageContextMenu}
              />
            </button>
          </div>
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

function PlaylistsView() {
  return (
    <section className="playlists-section" aria-labelledby="playlists-title">
      <div className="playlists-intro">
        <div className="eyebrow mono-label">curated frequency</div>
        <h1 id="playlists-title">my playlists</h1>
        <p>
          two places for the tracks that keep the signal moving.
        </p>
      </div>

      <div className="playlist-list">
        {playlists.map(({ name, number, spotifyHref }) => (
          <article className={`playlist-card playlist-card--${number}`} key={name}>
            <div className="playlist-card__index mono-label">{number} / collection</div>
            <div className="playlist-card__body">
              <div>
                <span className="playlist-card__eyebrow mono-label">personal mix</span>
                <h2>{name}</h2>
              </div>
              <div className="playlist-card__actions">
                <a
                  className="playlist-action playlist-action--spotify"
                  href={spotifyHref}
                  rel="noreferrer"
                  target="_blank"
                >
                  <SiSpotify aria-hidden="true" />
                  Spotify
                  <ExternalLink aria-hidden="true" />
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function getNextBirthday(now: Date) {
  const birthday = new Date(now.getFullYear(), 7, 13);
  if (birthday.getTime() < now.getTime()) {
    birthday.setFullYear(birthday.getFullYear() + 1);
  }
  return birthday;
}

function escapeIcsValue(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function formatIcsTimestamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function downloadBirthdayCalendar() {
  const year = new Date().getFullYear();
  const startDate = `${year}0813`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RedL1zar//Birthday//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:RedL1zar birthday',
    'BEGIN:VEVENT',
    'UID:redl1zar-birthday@personal-links',
    `DTSTAMP:${formatIcsTimestamp(new Date())}`,
    `DTSTART;VALUE=DATE:${startDate}`,
    'RRULE:FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=13',
    `SUMMARY:${escapeIcsValue("RedL1zar's birthday")}`,
    `DESCRIPTION:${escapeIcsValue('RedL1zar birthday — 13 August')}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blobUrl = URL.createObjectURL(
    new Blob([ics], { type: 'text/calendar;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = 'redl1zar-birthday.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function BirthdayView() {
  const [now, setNow] = useState(() => new Date());
  const birthday = getNextBirthday(now);
  const remaining = Math.max(0, birthday.getTime() - now.getTime());
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="birthday-section" aria-labelledby="birthday-title">
      <div className="birthday-intro">
        <div className="eyebrow mono-label">next personal signal</div>
        <h1 id="birthday-title">13 august</h1>
        <p>counting down to the next orbit around the sun.</p>
      </div>

      <div className="birthday-countdown" aria-live="polite">
        {[
          ['days', days],
          ['hours', hours],
          ['minutes', minutes],
          ['seconds', seconds],
        ].map(([label, value]) => (
          <div className="birthday-countdown__unit" key={label}>
            <strong>{String(value).padStart(2, '0')}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <button
        className="birthday-calendar-button"
        data-testid="button-add-birthday-calendar"
        onClick={downloadBirthdayCalendar}
        type="button"
      >
        <CalendarPlus aria-hidden="true" />
        add to device calendar
      </button>
      <p className="birthday-note">
        downloads a yearly calendar event for 13 August.
      </p>
    </section>
  );
}

function SendView() {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage || status === 'sending') return;

    setStatus('sending');
    setStatusMessage('');
    try {
      const response = await fetch(apiUrl('/api/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmedMessage }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message ?? 'Не удалось отправить сообщение.');
      }

      setMessage('');
      setStatus('sent');
      setStatusMessage('Сообщение отправлено.');
    } catch (error) {
      setStatus('error');
      setStatusMessage(
        error instanceof Error ? error.message : 'Не удалось отправить сообщение.',
      );
    }
  };

  return (
    <section className="send-section" aria-labelledby="send-title">
      <div className="send-intro">
        <div className="eyebrow mono-label">open channel</div>
        <h1 id="send-title">send</h1>
        <p>leave me an anonymous message. it will come to me in Telegram.</p>
      </div>

      <form className="send-form" onSubmit={submitMessage}>
        <label className="send-field">
          <span className="mono-label">your message</span>
          <textarea
            aria-describedby="send-note"
            data-testid="input-anonymous-message"
            maxLength={2000}
            onChange={(event) => {
              setMessage(event.target.value);
              if (status !== 'idle') {
                setStatus('idle');
                setStatusMessage('');
              }
            }}
            placeholder="write something into the signal..."
            required
            value={message}
          />
        </label>
        <div className="send-form__footer">
          <span className="send-counter mono-label">{message.length} / 2000</span>
          <button
            className="send-submit"
            data-testid="button-send-message"
            disabled={status === 'sending'}
            type="submit"
          >
            {status === 'sending' ? 'sending…' : 'send anonymously ↗'}
          </button>
        </div>
        <p className="send-note mono-label" id="send-note">
          no name, email, or account required
        </p>
        {statusMessage ? (
          <p
            aria-live="polite"
            className={`send-status send-status--${status}`}
            data-testid="status-send-message"
          >
            {statusMessage}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function NowPlaying() {
  const [state, setState] = useState<SpotifyCurrentlyPlaying | null>(null);
  const [yandexHref, setYandexHref] = useState(YANDEX_404_URL);
  const [liquidCoverFailed, setLiquidCoverFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    let requestInFlight = false;

    const loadCurrentTrack = async () => {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const nextState = await getCurrentSpotifyTrack();
        if (mounted) {
          const previewState =
            nextState.status === 'not_connected' || nextState.status === 'not_configured'
              ? getPreviewState()
              : null;
          setState(previewState ?? nextState);
        }
      } catch {
        if (mounted) {
          setState(
            getPreviewState() ?? {
              status: 'unavailable',
              track: null,
              message: 'Spotify временно недоступен',
            },
          );
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
  useEffect(() => {
    let active = true;
    if (!track) {
      setYandexHref(YANDEX_404_URL);
      return () => {
        active = false;
      };
    }

    const params = new URLSearchParams({
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    const yandexSearchFallback = `https://music.yandex.ru/search?text=${encodeURIComponent(
      [track.title, track.artist, track.album].filter(Boolean).join(' '),
    )}`;
    setYandexHref(yandexSearchFallback);

    fetch(apiUrl(`/api/yandex/track?${params.toString()}`), { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { url?: string };
      })
      .then((result) => {
        if (active && result?.url) setYandexHref(result.url);
      })
      .catch(() => {
        if (active) setYandexHref(yandexSearchFallback);
      });

    return () => {
      active = false;
    };
  }, [track?.album, track?.artist, track?.title]);

  const coverUrl = track?.imageUrl ? getSpotifyCoverUrl(track.imageUrl) : null;
  const {
    imageUrl: coverImageUrl,
    handleError: handleCoverError,
    handleLoad: handleCoverLoad,
  } = useSpotifyCover(coverUrl);
  useEffect(() => {
    setLiquidCoverFailed(false);
  }, [coverUrl]);
  const handleLiquidCoverError = () => {
    setLiquidCoverFailed(true);
  };
  const handleLiquidCoverLoad = () => {
    setLiquidCoverFailed(false);
  };
  const renderCoverUrl = coverImageUrl;
  const renderLiquidCoverUrl =
    coverImageUrl && !liquidCoverFailed ? coverImageUrl : null;
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
        <div
          className="now-playing-card"
        >
          {renderLiquidCoverUrl ? (
            <img
              className="now-playing-liquid-art"
              src={renderLiquidCoverUrl}
              alt=""
              aria-hidden="true"
              decoding="async"
              draggable={false}
              loading="eager"
              onError={handleLiquidCoverError}
              onLoad={handleLiquidCoverLoad}
              onContextMenu={preventImageContextMenu}
            />
          ) : (
            <span className="now-playing-liquid-fallback" aria-hidden="true" />
          )}
          {renderCoverUrl ? (
            <img
              className="now-playing-art"
              src={renderCoverUrl}
              alt={`Обложка альбома «${track.album}»`}
              decoding="async"
              draggable={false}
              fetchPriority="high"
              loading="eager"
              onError={handleCoverError}
              onLoad={handleCoverLoad}
              onContextMenu={preventImageContextMenu}
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
          <span className="now-playing-card-actions">
            <a
              aria-label="Открыть текущий трек в Spotify"
              className="now-playing-arrow"
              data-testid="link-current-track"
              href={track.spotifyUrl}
              rel="noreferrer"
              target="_blank"
            >
              ↗
            </a>
            <a
              aria-label="Открыть текущий трек в Яндекс Музыке"
              className="now-playing-yandex-icon"
              data-testid="link-current-track-yandex"
              href={yandexHref}
              rel="noreferrer"
              target="_blank"
            >
              <img
                src={yandexMusicLogo}
                alt=""
                draggable={false}
                onContextMenu={preventImageContextMenu}
              />
            </a>
          </span>
        </div>
      ) : (
        <div className="now-playing-empty" data-testid="status-current-track">
          <span className="now-playing-empty-icon" aria-hidden="true">
            <SiSpotify />
          </span>
          <span>{state?.message ?? 'Проверяем Spotify…'}</span>
        </div>
      )}
      <SteamNowPlaying />
    </section>
  );
}

function SteamNowPlaying() {
  const [state, setState] = useState<SteamCurrentlyPlaying | null>(null);

  useEffect(() => {
    let active = true;
    let requestInFlight = false;

    const loadCurrentGame = async () => {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const nextState = await getCurrentSteamGame();
        if (active) setState(nextState);
      } catch {
        if (active) {
          setState({
            status: 'unavailable',
            game: null,
            message: 'Steam временно недоступен',
          });
        }
      } finally {
        requestInFlight = false;
      }
    };

    void loadCurrentGame();
    const intervalId = window.setInterval(loadCurrentGame, 30_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const game = state?.game;
  const statusText =
    state?.status === 'playing'
      ? 'currently playing'
      : state?.status === 'unavailable'
        ? 'steam signal'
        : 'not playing';

  return (
    <div
      aria-live="polite"
      className={`steam-now-playing ${game ? 'steam-now-playing--active' : ''}`}
      data-testid="steam-now-playing"
    >
      <span className="steam-now-playing__label mono-label">steam / now</span>
      <span className="steam-now-playing__content">
        {game?.imageUrl ? (
          <img
            className="steam-now-playing__image"
            src={game.imageUrl}
            alt=""
            draggable={false}
            onContextMenu={preventImageContextMenu}
          />
        ) : (
          <span className="steam-now-playing__image steam-now-playing__image--empty" aria-hidden="true">
            <SiSteam />
          </span>
        )}
        <span className="steam-now-playing__copy">
          <span className="steam-now-playing__status mono-label">{statusText}</span>
          <strong>{game?.name ?? state?.message ?? 'Проверяем Steam…'}</strong>
        </span>
        {game ? (
          <a
            aria-label={`Открыть ${game.name} в Steam`}
            className="steam-now-playing__link"
            href={game.steamUrl}
            rel="noreferrer"
            target="_blank"
          >
            ↗
          </a>
        ) : null}
      </span>
    </div>
  );
}

export default Home;
