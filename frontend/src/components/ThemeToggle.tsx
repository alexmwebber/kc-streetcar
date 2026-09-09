import type { Theme } from "../lib/useTheme.js";

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

/** Bottom-left light/dark switch. Shows the icon of the mode it will switch to. */
export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === "dark";
  const label = `Switch to ${isDark ? "light" : "dark"} mode`;

  return (
    <button type="button" className="theme-toggle" onClick={onToggle} aria-label={label} title={label}>
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 8.9 10.36A7 7 0 0 1 11.64 4.1c0-.37.03-.74.09-1.1H12z" />
        </svg>
      )}
    </button>
  );
}
