import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Label + control + hint + error, in one place.
 *
 * Every form in the app is hand-assembled `useState` markup, so labels, hint
 * text and error styling drifted per dialog. This does not replace a form
 * library — it just makes one field look and behave the same everywhere.
 *
 * Pass the same string to `htmlFor` and the control's `id` so clicking the
 * label focuses the control.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  /** Shown below the control until an error replaces it. */
  hint?: React.ReactNode;
  /** Message explaining what went wrong and how to fix it. */
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? (
            <span aria-hidden className="text-destructive">
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
