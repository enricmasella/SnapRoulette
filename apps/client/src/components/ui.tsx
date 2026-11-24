import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-lime text-night hover:bg-lime-strong",
  ghost: "border border-line bg-surface-2 text-ink hover:border-muted",
  danger: "border border-line bg-surface-2 text-danger hover:border-danger",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`h-12 rounded-full px-6 font-display text-base font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>;
}

const AVATAR_SIZES = {
  sm: "h-9 w-9 text-lg",
  md: "h-12 w-12 text-2xl",
  lg: "h-16 w-16 text-3xl",
} as const;

export function Avatar({
  emoji,
  size = "md",
}: {
  emoji: string;
  size?: keyof typeof AVATAR_SIZES;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 ${AVATAR_SIZES[size]}`}
    >
      {emoji}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-lime border-t-transparent ${className}`}
    />
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <h1 className={`font-display font-bold tracking-tight text-lime ${className}`}>SnapRoulette</h1>
  );
}

export function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div
        role="alert"
        className="flex items-center gap-3 rounded-full border border-danger/40 bg-night/95 px-5 py-3 shadow-xl backdrop-blur"
      >
        <span aria-hidden="true" className="text-danger">
          ⚠️
        </span>
        <p className="text-sm font-medium">{message}</p>
        <button
          type="button"
          aria-label="Cerrar error"
          onClick={onClose}
          className="text-muted transition-colors hover:text-ink"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-12 w-full rounded-xl border border-line bg-surface-2 px-4 text-base text-ink placeholder:text-muted focus:border-lime ${className}`}
      {...props}
    />
  );
}
