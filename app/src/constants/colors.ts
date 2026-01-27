// Color Reference for the application

export const colors = {
  // Background Colors
  bg: {
    primary: "#000000",
    secondary: "#0a0a0a",
    tertiary: "#111111",
    hover: "#1a1a1a",
    surface: "rgba(10, 10, 10, 0.95)",
    surfaceSecondary: "rgba(20, 20, 20, 0.8)",
    surfaceTertiary: "rgba(15, 15, 15, 0.6)",
    glass: "rgba(5, 5, 5, 0.4)",
  },

  // Text Colors
  text: {
    primary: "#ffffff",
    secondary: "#e0e0e0",
    tertiary: "#a0a0a0",
    muted: "#606060",
  },

  // Border Colors
  border: {
    primary: "rgba(255, 255, 255, 0.08)",
    hover: "rgba(255, 255, 255, 0.15)",
    accent: "rgba(255, 255, 255, 0.2)",
  },

  // Accent Color - Cyan (Single consistent accent)
  accent: {
    // Primary accent - use for main interactive elements
    primary: "#22d3ee", // cyan-400
    // Hover states
    hover: "#06b6d4", // cyan-500
    // Light variant for glows and highlights
    light: "#67e8f9", // cyan-300
    // Dark variant for borders and subtle accents
    dark: "#0891b2", // cyan-600

    // Opacity variants for backgrounds
    bg10: "rgba(34, 211, 238, 0.1)",
    bg20: "rgba(34, 211, 238, 0.2)",
    bg30: "rgba(34, 211, 238, 0.3)",
    bg40: "rgba(34, 211, 238, 0.4)",
    bg50: "rgba(34, 211, 238, 0.5)",
    bg60: "rgba(34, 211, 238, 0.6)",

    // Border opacity variants
    border20: "rgba(34, 211, 238, 0.2)",
    border30: "rgba(34, 211, 238, 0.3)",
    border40: "rgba(34, 211, 238, 0.4)",
    border50: "rgba(34, 211, 238, 0.5)",

    // Text variants
    text: "#22d3ee",
    textLight: "#67e8f9",
    textDark: "#06b6d4",
  },

  // Semantic Colors (unchanged - for warnings/errors)
  semantic: {
    success: "#22d3ee", // Use accent color for success (consistent)
    warning: "#fbbf24", // amber-400
    error: "#ef4444", // red-500
  },

  // Face Recognition Colors (using accent variants)
  face: {
    recognized: "#22d3ee", // cyan-400 (was green)
    unknown: "#ef4444", // red-500 (unchanged - semantic error)
    // Alternative: use different cyan shades for recognized
    recognizedLight: "#67e8f9", // cyan-300 for subtle recognition
  },
} as const;

export const colorClasses = {
  // Backgrounds
  bgPrimary: "bg-black",
  bgSecondary: "bg-[#0a0a0a]",
  bgTertiary: "bg-[#111111]",
  bgHover: "bg-[#1a1a1a]",
  bgSurface: "bg-white/5",
  bgSurfaceSecondary: "bg-white/10",

  // Text
  textPrimary: "text-white",
  textSecondary: "text-white/90",
  textTertiary: "text-white/60",
  textMuted: "text-white/40",

  // Borders
  borderPrimary: "border-white/10",
  borderHover: "border-white/15",
  borderAccent: "border-white/20",

  // Accent (Cyan)
  accent: "text-cyan-400",
  accentBg: "bg-cyan-400",
  accentBorder: "border-cyan-400",
  accentBg10: "bg-cyan-400/10",
  accentBg20: "bg-cyan-400/20",
  accentBg30: "bg-cyan-400/30",
  accentBorder20: "border-cyan-400/20",
  accentBorder30: "border-cyan-400/30",
  accentBorder40: "border-cyan-400/40",
  accentBorder50: "border-cyan-400/50",

  // Semantic
  success: "text-cyan-400", // Use accent for success
  successBg: "bg-cyan-400/20",
  successBorder: "border-cyan-400/30",
  warning: "text-amber-400",
  warningBg: "bg-amber-400/20",
  warningBorder: "border-amber-400/30",
  error: "text-red-500",
  errorBg: "bg-red-500/20",
  errorBorder: "border-red-500/30",
} as const;
