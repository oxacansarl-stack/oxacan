import React from 'react';
import { useTranslation } from 'react-i18next';
// Towers under a pale sky — Unsplash (free to use, no attribution required):
// https://unsplash.com/photos/1486406146926-c627a92ad1ab — bundled locally so the app calls no CDN (LPD).
import hero from '../assets/login-hero.jpg';

/**
 * Shell of the unauthenticated pages (login, set-password): a full-height hero panel carrying the
 * brand over the site photograph, and a chalk column holding the form card. On small screens the
 * hero collapses and the brand row sits above the card.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('auth');
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-chalk">
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-graphite p-12 xl:p-16">
        <img
          src={hero}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[35%_78%] opacity-95"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-graphite via-graphite/75 to-graphite/25" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-graphite/90 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-graphite/80 to-transparent" />

        <Brand className="relative" dark />
        <div className="relative max-w-md">
          <h1 className="font-display text-5xl xl:text-6xl font-bold leading-[1.05] tracking-tight text-paper">
            {t('headline')}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-side-fg">{t('subline')}</p>
          <div className="mt-8 h-1 w-16 rounded-full bg-volt" />
        </div>
        <p className="relative text-xs text-side-dim">{t('photo')}</p>
      </aside>

      <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
        <Brand className="lg:hidden" />
        <div className="w-full max-w-[400px] rounded-lg border border-line bg-paper p-8 shadow-[0_18px_44px_-24px_rgba(23,25,28,0.35)]">
          {children}
        </div>
      </main>
    </div>
  );
}

export function Brand({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-md bg-volt font-display text-[13px] font-bold text-graphite">
        OX
      </span>
      <span className="leading-tight">
        <span className={`block font-display text-[15px] font-bold tracking-[0.14em] ${dark ? 'text-paper' : 'text-ink'}`}>
          OXACAN
        </span>
        <span className={`block text-xs ${dark ? 'text-side-dim' : 'text-muted'}`}>{t('app.tagline')}</span>
      </span>
    </div>
  );
}
