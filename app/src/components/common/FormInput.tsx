import { forwardRef } from "react";

interface FormInputProps {
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  focusColor?: string;
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  (
    {
      type = "text",
      value,
      onChange,
      onKeyDown,
      placeholder,
      disabled = false,
      className = "",
      focusColor = "border-white/20",
    },
    ref,
  ) => {
    return (
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:${focusColor} ${className}`}
      />
    );
  },
);

FormInput.displayName = "FormInput";
