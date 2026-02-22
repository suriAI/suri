import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface DropdownOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface DropdownProps<T = string> {
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
}

export function Dropdown<T extends string | number = string>({
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
  maxHeight = 256, // 64 * 4 = 256px default
  showPlaceholderOption = true,
  allowClear = true,
}: DropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption?.label || placeholder;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
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

  // Close dropdown on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  // Calculate dropdown position and direction (auto-positioning with fixed positioning)
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - buttonRect.bottom;
      const spaceAbove = buttonRect.top;
      const estimatedHeight = Math.min(maxHeight, options.length * 36 + 20); // Approximate item height

      // Determine if should open upward
      const shouldOpenUp =
        spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

      // Calculate fixed position to escape scroll containers and avoid overlaps
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

  const handleSelect = (optionValue: T) => {
    const option = options.find((opt) => opt.value === optionValue);
    if (!option?.disabled) {
      onChange(optionValue);
      setIsOpen(false);
    }
  };

  return (
    <div className={`relative min-w-0 ${className}`} ref={dropdownRef}>
      {/* Dropdown Button */}
      <button
        type="button"
        ref={buttonRef}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full bg-white/5 border border-white/10 rounded-md pl-3 pr-2 py-2 text-sm text-white
          focus:outline-none focus:border-white/20 transition-all cursor-pointer text-left
          flex items-center justify-between hover:bg-white/8
          disabled:opacity-50 disabled:cursor-not-allowed min-w-0
          ${buttonClassName}
        `}
      >
        <span className="truncate flex-1 min-w-0 text-left">{displayText}</span>
        {/* Chevron Icon - Right Aligned */}
        <i
          className={`fa-solid fa-chevron-down text-white/50 text-xs flex-shrink-0 ml-2 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          } ${iconClassName}`}
        ></i>
      </button>

      {/* Dropdown Menu - Rendered via Portal for correct positioning in transformed containers */}
      {isOpen &&
        !disabled &&
        menuPosition &&
        createPortal(
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[9998]"
              onClick={() => setIsOpen(false)}
            />
            {/* Options Container - Fixed positioning relative to viewport */}
            <div
              className="fixed z-[9999] bg-[#0c0c0c] border border-white/10 rounded-md overflow-hidden"
              style={{
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                width: `${menuPosition.width}px`,
              }}
            >
              {/* Scrollable Container with Max Height */}
              <div
                className="overflow-y-auto custom-scroll"
                style={{ maxHeight: `${maxHeight}px` }}
              >
                {/* Empty State */}
                {options.length === 0 ? (
                  <div className="px-3 py-3 text-center text-white/50 text-sm">
                    {emptyMessage}
                  </div>
                ) : (
                  <>
                    {/* Placeholder Option */}
                    {showPlaceholderOption && allowClear && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onChange(null as T | null);
                            setIsOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
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
                    {/* Options */}
                    {options.map((option) => (
                      <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => handleSelect(option.value)}
                        disabled={option.disabled}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors truncate ${
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
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
