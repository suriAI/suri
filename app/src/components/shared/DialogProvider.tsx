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
import { Modal } from "@/components/common";

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

  return (
    <DialogContext.Provider value={api}>
      {children}

      <Modal
        isOpen={!!active}
        onClose={handleOverlayClick}
        title={active?.options.title}
        icon={
          active?.type === "confirm" ? (
            <i className="fa-solid fa-triangle-exclamation text-orange-300" />
          ) : (
            <i className="fa-solid fa-circle-info text-cyan-300" />
          )
        }
        maxWidth="sm"
      >
        <div className="space-y-6">
          <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">
            {active?.options.message}
          </p>

          <div className="flex justify-end">
            <button
              ref={primaryButtonRef}
              type="button"
              className={
                getButtonClasses(
                  active?.type === "alert"
                    ? active.options.variant || "default"
                    : active?.options.confirmVariant || "default",
                ) + " w-full"
              }
              onClick={() => {
                if (active?.type === "alert") {
                  active.resolve();
                } else {
                  active?.resolve(true);
                }
                close();
              }}
            >
              {active?.type === "alert"
                ? active.options.buttonText || "OK"
                : active?.options.confirmText}
            </button>
          </div>
        </div>
      </Modal>
    </DialogContext.Provider>
  );
}
