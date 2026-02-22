import React, { useEffect, useRef } from "react";
import { ModalCloseButton } from "@/components/common/ModalCloseButton";

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | string;
  hideCloseButton?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  icon,
  children,
  maxWidth = "sm",
  hideCloseButton = false,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    if (!isOpen || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass =
    {
      sm: "max-w-sm",
      md: "max-w-md",
      lg: "max-w-lg",
      xl: "max-w-xl",
      "2xl": "max-w-2xl",
    }[maxWidth] || maxWidth;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className={`w-full ${maxWidthClass} bg-[#09090b]/95 border border-white/10 rounded-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          {(title || !hideCloseButton) && (
            <div
              className={`flex items-start ${title ? "justify-between mb-5" : "justify-end mb-2"}`}
            >
              {title && (
                <div className="flex items-center gap-2">
                  {icon}
                  <h2 className="text-base font-semibold text-white tracking-tight">
                    {title}
                  </h2>
                </div>
              )}
              {!hideCloseButton && onClose && (
                <ModalCloseButton onClick={onClose} />
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
