"use client";

import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
    size?: "sm" | "md" | "lg";
  }
>(({ className, variant = "primary", size = "md", ...props }, ref) => {
  const base =
    "t-display inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none";
  const variants = {
    primary: "bg-matcha-500 text-white hover:bg-matcha-600 active:bg-matcha-700",
    secondary: "bg-cream-200 text-matcha-900 hover:bg-cream-300",
    ghost: "bg-transparent text-matcha-900 hover:bg-cream-200",
    danger: "bg-red-600 text-white hover:bg-red-700",
    outline: "border border-matcha-200 bg-white text-matcha-900 hover:bg-cream-100",
  };
  const sizes = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-5 text-base",
  };
  return (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
});
Button.displayName = "Button";

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-cream-200 bg-white p-4 shadow-sm",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  const { className, ...rest } = props;
  return (
    <input
      className={cn(
        "h-10 w-full rounded-xl border border-cream-200 bg-white px-3 text-sm placeholder:text-matcha-900/40",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * Number input that lets the user fully clear the field (backspace → empty)
 * without the zero re-appearing. Internally tracks the raw string so
 * intermediate states like "0." or "" are allowed during typing. Parent
 * sees the parsed number on every keystroke (0 for empty).
 */
export function NumberField({
  value,
  onChange,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (n: number) => void;
}) {
  // Local draft while the user is typing; null means "follow parent".
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (value === 0 ? "" : String(value));
  return (
    <input
      type="number"
      inputMode="decimal"
      className={cn(
        "h-10 w-full rounded-xl border border-cream-200 bg-white px-3 text-sm placeholder:text-matcha-900/40",
        className,
      )}
      value={display}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (v === "") {
          onChange(0);
        } else {
          const n = Number(v);
          if (!Number.isNaN(n)) onChange(n);
        }
      }}
      onBlur={() => setDraft(null)}
      // Block mouse-wheel scroll from changing the value. Blurring the input
      // (instead of preventDefault on the wheel event) keeps page scrolling
      // working when the cursor happens to be over the field.
      onWheel={(e) => (e.target as HTMLInputElement).blur()}
      {...rest}
    />
  );
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const { className, ...rest } = props;
  return (
    <textarea
      className={cn(
        "w-full rounded-xl border border-cream-200 bg-white px-3 py-2 text-sm placeholder:text-matcha-900/40",
        className,
      )}
      {...rest}
    />
  );
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  const { className, children, ...rest } = props;
  return (
    <select
      className={cn(
        "h-10 w-full rounded-xl border border-cream-200 bg-white px-3 text-sm",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("t-caption text-xs text-matcha-900/70", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="t-caption text-xs text-matcha-900/50">{hint}</p> : null}
    </div>
  );
}

export function Badge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: "neutral" | "pending" | "in_progress" | "completed" | "cancelled" | "paid" | "unpaid" | "comped" | "warning";
  className?: string;
}) {
  const styles: Record<string, string> = {
    neutral: "bg-cream-200 text-matcha-900",
    pending: "bg-amber-100 text-amber-900",
    in_progress: "bg-blue-100 text-blue-900",
    completed: "bg-matcha-100 text-matcha-700",
    cancelled: "bg-gray-100 text-gray-500",
    paid: "bg-matcha-100 text-matcha-700",
    unpaid: "bg-amber-100 text-amber-900",
    comped: "bg-purple-100 text-purple-900",
    warning: "bg-amber-100 text-amber-900",
  };
  return (
    <span
      className={cn(
        "t-caption inline-flex items-center rounded-full px-2 py-0.5 text-[11px]",
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Chip({
  active,
  onClick,
  children,
  disabled,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "t-caption rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-matcha-500 bg-matcha-500 text-white"
          : "border-cream-200 bg-white text-matcha-900 hover:bg-cream-100",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Sheet({
  open,
  onClose,
  side = "right",
  children,
}: {
  open: boolean;
  onClose: () => void;
  side?: "right" | "bottom";
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={onClose}
      style={{
        alignItems: side === "bottom" ? "flex-end" : "stretch",
        justifyContent: side === "right" ? "flex-end" : "stretch",
      }}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative z-10 overflow-y-auto bg-white shadow-xl",
          side === "right"
            ? "h-full w-full max-w-md rounded-l-2xl"
            : "max-h-[90vh] w-full rounded-t-2xl",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl max-h-[90vh]"
      >
        {title ? (
          <h3 className="t-display mb-4 text-lg">{title}</h3>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-cream-300 bg-white p-10 text-center">
      <h3 className="t-display text-base text-matcha-900">{title}</h3>
      {description ? (
        <p className="t-caption mt-1 text-sm text-matcha-900/60">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
