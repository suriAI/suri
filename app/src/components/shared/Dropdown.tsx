import { useState, useEffect, useRef, forwardRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export interface DropdownOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface DropdownProps<T = string> extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  options: DropdownOption<T>[];
  value: T | null | undefined;
  onChange: (value: T | null) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  buttonClassName?: string;
  optionClassName?: string;
  iconClassName?: string;
  disabled?: boolean;
  maxHeight?: number; // in pixels
  showPlaceholderOption?: boolean;
  allowClear?: boolean; // Allow selecting placeholder to clear value
  trigger?: React.ReactNode;
  menuWidth?: number | string;
}

export const Dropdown = forwardRef<
  HTMLDivElement,
  DropdownProps<string | number>
>(
  (
    {
      options,
      value,
      onChange,
      placeholder = "Select…",
      emptyMessage = "No options available",
      className = "",
      buttonClassName = "",
      optionClassName = "",
      iconClassName = "",
      disabled = false,
      maxHeight = 256,
      showPlaceholderOption = true,
      allowClear = true,
      trigger,
      menuWidth,
      ...props
    },
    ref,
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<{
      top: number;
      left: number;
      width: number;
    } | null>(null);
    const internalRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Combine refs
    useEffect(() => {
      if (!ref) return;
      if (typeof ref === "function") {
        ref(internalRef.current);
      } else {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current =
          internalRef.current;
      }
    }, [ref]);

    const selectedOption = options.find((opt) => opt.value === value);
    const displayText = selectedOption?.label || placeholder;

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          internalRef.current &&
          !internalRef.current.contains(event.target as Node)
        ) {
          setIsOpen(false);
        }
      };

      if (isOpen) {
        document.addEventListener("mousedown", handleClickOutside);
      }

      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [isOpen]);

    useEffect(() => {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isOpen) {
          setIsOpen(false);
        }
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen]);

    useEffect(() => {
      if (isOpen && buttonRef.current) {
        const buttonRect = buttonRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - buttonRect.bottom;
        const spaceAbove = buttonRect.top;
        const estimatedHeight = Math.min(maxHeight, options.length * 36 + 20);

        const shouldOpenUp =
          spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

        setMenuPosition({
          top: shouldOpenUp
            ? buttonRect.top - estimatedHeight - 4
            : buttonRect.bottom + 4,
          left: buttonRect.left,
          width: buttonRect.width,
        });
      } else {
        setMenuPosition(null);
      }
    }, [isOpen, maxHeight, options.length]);

    const handleSelect = (optionValue: string | number) => {
      const option = options.find((opt) => opt.value === optionValue);
      if (!option?.disabled) {
        onChange(optionValue);
        setIsOpen(false);
      }
    };

    return (
      <div
        className={`relative min-w-0 ${className}`}
        ref={internalRef}
        {...props}
      >
        <button
          type="button"
          ref={buttonRef}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
          w-full bg-white/5 border border-white/10 rounded-lg py-2 text-sm text-white
          focus:outline-none focus:border-white/20 transition-all cursor-pointer text-left
          flex items-center justify-between hover:bg-white/8
          disabled:opacity-50 disabled:cursor-not-allowed min-w-0
          ${trigger ? "px-0 justify-center" : "pl-3 pr-2"}
          ${buttonClassName}
        `}
        >
          {trigger ? (
            trigger
          ) : (
            <>
              <span className="truncate flex-1 min-w-0 text-left">
                {displayText}
              </span>
              <i
                className={`fa-solid fa-chevron-down text-white/50 text-xs flex-shrink-0 ml-2 transition-transform duration-200 ${
                  isOpen ? "rotate-180" : ""
                } ${iconClassName}`}
              ></i>
            </>
          )}
        </button>

        {createPortal(
          <AnimatePresence>
            {isOpen && !disabled && menuPosition && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-[9998]"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setIsOpen(false)}
                />

                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="fixed z-[9999] bg-[#0c0c0c] border border-white/10 rounded-lg overflow-hidden shadow-xl"
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    top: `${menuPosition.top}px`,
                    left: menuWidth ? undefined : `${menuPosition.left}px`,
                    right: menuWidth
                      ? window.innerWidth -
                        (buttonRef.current?.getBoundingClientRect().right || 0)
                      : undefined,
                    width: menuWidth
                      ? typeof menuWidth === "number"
                        ? `${menuWidth}px`
                        : menuWidth
                      : `${menuPosition.width}px`,
                    transformOrigin:
                      menuPosition.top <
                      (buttonRef.current?.getBoundingClientRect().top || 0)
                        ? "bottom right"
                        : "top right",
                  }}
                >
                  <div
                    className="overflow-y-auto custom-scroll"
                    style={{ maxHeight: `${maxHeight}px` }}
                  >
                    {options.length === 0 ? (
                      <div className="px-3 py-2 text-center text-white/50 text-sm">
                        {emptyMessage}
                      </div>
                    ) : (
                      <>
                        {showPlaceholderOption && allowClear && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                onChange(null);
                                setIsOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm transition-colors rounded-none ${
                                !value
                                  ? "bg-white/10 text-white"
                                  : "text-white/70 hover:bg-white/5 hover:text-white"
                              } ${optionClassName}`}
                            >
                              {placeholder}
                            </button>
                            {options.length > 0 && (
                              <div className="h-px bg-white/10 mx-2"></div>
                            )}
                          </>
                        )}

                        {options.map((option) => (
                          <button
                            key={String(option.value)}
                            type="button"
                            onClick={() => handleSelect(option.value)}
                            disabled={option.disabled}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors truncate rounded-none ${
                              value === option.value
                                ? "bg-white/10 text-white"
                                : option.disabled
                                  ? "text-white/30 cursor-not-allowed"
                                  : "text-white/70 hover:bg-white/5 hover:text-white"
                            } ${optionClassName}`}
                            title={option.label}
                          >
                            {option.label}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>
    );
  },
);

Dropdown.displayName = "Dropdown";
