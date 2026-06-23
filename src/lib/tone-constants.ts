export const TONES = {
  primary: "text-[var(--hype-green-dark)] bg-primary/10",
  info: "text-blue-600 bg-blue-50",
  indigo: "text-indigo-600 bg-indigo-50",
  cyan: "text-cyan-600 bg-cyan-50",
  amber: "text-amber-600 bg-amber-50",
  emerald: "text-emerald-600 bg-emerald-50",
  rose: "text-rose-600 bg-rose-50",
} as const;

export type Tone = keyof typeof TONES;
