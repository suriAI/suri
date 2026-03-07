import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
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

  useEffect(() => {
    if (!isOpen || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const maxWidthClass =
    {
      sm: "max-w-sm",
      md: "max-w-md",
      lg: "max-w-lg",
      xl: "max-w-xl",
      "2xl": "max-w-2xl",
    }[maxWidth] || maxWidth;

  const snappyTransition = {
    duration: 0.25,
    ease: [0.16, 1, 0.3, 1] as const,
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-100 flex items-center justify-center px-4 overflow-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={snappyTransition}
        style={{ willChange: "transform, opacity" }}
        className={`w-full ${maxWidthClass} bg-[#080808] rounded-xl overflow-hidden border border-white/5 relative z-10`}
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
                  <h2 className="text-base font-semibold text-white tracking-tight leading-none">
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
      </motion.div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
