"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "under-changes-dismissed";

export function UnderChangesBanner() {
  const [show, setShow] = useState(false);
  const dismissedRef = useRef(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      dismissedRef.current = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setShow(true));
      });
    }
  }, []);

  const handleDismiss = () => {
    setShow(false);
    setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, "true");
      dismissedRef.current = true;
    }, 300);
  };

  if (dismissedRef.current && !show) return null;

  return (
    <div
      className={
        show
          ? "fixed top-0 left-0 right-0 z-[60] translate-y-0 opacity-100 transition-all duration-300 ease-in-out"
          : "fixed top-0 left-0 right-0 z-[60] -translate-y-full opacity-0 transition-all duration-300 ease-in-out"
      }
    >
      <div className="flex items-center justify-between gap-4 bg-amber-50 border-b border-amber-200 px-4 py-3 shadow-md">
        <p className="text-sm font-medium text-amber-900">
          Currently under major changes. For any error contact AI Team.
        </p>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 rounded-md p-1 text-amber-600 hover:bg-amber-100 hover:text-amber-800 transition-colors"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
