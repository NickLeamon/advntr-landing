import type { ReactNode } from 'react';

export function Avatar({ name, emoji, avatarUrl, size = 28 }: {
  name: string; emoji?: string | null; avatarUrl?: string | null; size?: number;
}) {
  // photo > emoji > initials, same precedence as the app's Avatar.
  const initials = name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (avatarUrl) return <img className="avatar" style={style} src={avatarUrl} alt={name} />;
  return <span className="avatar" style={style} title={name}>{emoji || initials}</span>;
}

export function StarRow({ value, onPick, disabled }: {
  value: number | null; onPick?: (n: number) => void; disabled?: boolean;
}) {
  return (
    <span className="stars" role={onPick ? 'radiogroup' : undefined} aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star${value != null && n <= value ? ' on' : ''}`}
          disabled={disabled || !onPick}
          aria-label={`${n} out of 5`}
          aria-checked={value === n}
          role={onPick ? 'radio' : undefined}
          onClick={() => onPick?.(n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export function Section({ title, action, children }: {
  title: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="block">
      <div className="block-head">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return <p className={`banner${tone === 'error' ? ' error' : ''}`}>{children}</p>;
}
