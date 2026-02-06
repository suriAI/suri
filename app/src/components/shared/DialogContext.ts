import { createContext, useContext } from "react";

export type DialogVariant = "default" | "danger";

export interface AlertDialogOptions {
  title?: string;
  message: string;
  buttonText?: string;
  variant?: DialogVariant;
}

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: DialogVariant;
}

export interface DialogAPI {
  alert: (options: AlertDialogOptions) => Promise<void>;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
}

export const DialogContext = createContext<DialogAPI | null>(null);

export function useDialog(): DialogAPI {
  const api = useContext(DialogContext);
  if (!api) {
    throw new Error("useDialog must be used within DialogProvider");
  }
  return api;
}
