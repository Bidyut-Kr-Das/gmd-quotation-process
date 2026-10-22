"use client";

// Replaces the root layout when it crashes, so it can't rely on globals.css.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#737373" }}>The dashboard failed to load.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "6px 12px", borderRadius: 8, border: 0, background: "#171717", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
