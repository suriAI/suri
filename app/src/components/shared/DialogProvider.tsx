import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DialogContext,
  type AlertDialogOptions,
  type ConfirmDialogOptions,
  type DialogAPI,
  type DialogVariant,
} from "@/components/shared/DialogContext";

type ActiveDialogState =
  | {
      type: "alert";
      options: Required<Pick<AlertDialogOptions, "message">> &
        Omit<AlertDialogOptions, "message">;
      resolve: () => void;
    }
  | {
      type: "confirm";
      options: Required<Pick<ConfirmDialogOptions, "message">> &
        Omit<ConfirmDialogOptions, "message">;
      resolve: (result: boolean) => void;
    };

function getButtonClasses(variant: DialogVariant): string {
  if (variant === "danger") {
    return "px-4 py-2 rounded-md bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 transition-colors";
  }

  return "px-4 py-2 rounded-md bg-white/5 border border-white/10 text-white/80 hover:text-white hover:bg-white/10 transition-colors";
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDialogState | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      primaryButtonRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(id);
  }, [active]);

  const alert = useCallback(async (options: AlertDialogOptions) => {
    return await new Promise<void>((resolve) => {
      setActive({
        type: "alert",
        options: {
          title: options.title,
          message: options.message,
          buttonText: options.buttonText || "OK",
          variant: options.variant || "default",
        },
        resolve,
      });
    });
  }, []);

  const confirm = useCallback(async (options: ConfirmDialogOptions) => {
    return await new Promise<boolean>((resolve) => {
      setActive({
        type: "confirm",
        options: {
          title: options.title,
          message: options.message,
          confirmText: options.confirmText || "Confirm",
          cancelText: options.cancelText || "Cancel",
          confirmVariant: options.confirmVariant || "default",
        },
        resolve,
      });
    });
  }, []);

  const api = useMemo<DialogAPI>(() => ({ alert, confirm }), [alert, confirm]);

  const close = useCallback(() => {
    setActive(null);
  }, []);

  const handleOverlayClick = useCallback(() => {
    if (!active) return;
    if (active.type === "alert") {
      active.resolve();
      close();
      return;
    }

    active.resolve(false);
    close();
  }, [active, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      handleOverlayClick();
    },
    [handleOverlayClick],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}

      {active && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] px-4"
          onClick={handleOverlayClick}
          onKeyDown={handleKeyDown}
          role="presentation"
        >
          <div
            className="bg-[#0f0f0f] border border-white/10 p-6 rounded-2xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={
              active.options.title ||
              (active.type === "confirm" ? "Confirm" : "Message")
            }
          >
            {active.options.title && (
              <h3 className="text-lg font-semibold mb-3 text-white flex items-center gap-2">
                {active.type === "confirm" ? (
                  <i className="fa-solid fa-triangle-exclamation text-orange-300" />
                ) : (
                  <i className="fa-solid fa-circle-info text-cyan-300" />
                )}
                {active.options.title}
              </h3>
            )}

            <div className="mb-6">
              <p className="text-white/90 text-sm leading-relaxed whitespace-pre-wrap">
                {active.options.message}
              </p>
            </div>

            {active.type === "alert" ? (
              <div className="flex justify-end">
                <button
                  ref={primaryButtonRef}
                  type="button"
                  className={getButtonClasses(
                    active.options.variant || "default",
                  )}
                  onClick={() => {
                    active.resolve();
                    close();
                  }}
                >
                  {active.options.buttonText || "OK"}
                </button>
              </div>
            ) : (
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  className={getButtonClasses("default")}
                  onClick={() => {
                    active.resolve(false);
                    close();
                  }}
                >
                  {active.options.cancelText}
                </button>
                <button
                  ref={primaryButtonRef}
                  type="button"
                  className={getButtonClasses(
                    active.options.confirmVariant || "default",
                  )}
                  onClick={() => {
                    active.resolve(true);
                    close();
                  }}
                >
                  {active.options.confirmText}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
