import { useState } from 'react';
import { SiPinterest, SiSpotify, SiSteam, SiTelegram } from 'react-icons/si';

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
];

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

        <section className="links-section" aria-labelledby="links-title">
          <div className="links-header">
            <h2 id="links-title">Find me in other places</h2>
            <span className="mono-label">04 channels</span>
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
          <button
            className="copy-button"
            data-testid="button-copy-handle"
            onClick={copyHandle}
            type="button"
          >
            {copied ? 'handle copied' : 'copy @RedL1zar'}
          </button>
        </footer>
      </div>
    </main>
  );
}

export default Home;
