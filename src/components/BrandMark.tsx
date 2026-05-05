import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  animated?: boolean;
  compact?: boolean;
  className?: string;
  to?: string;
};

export const BrandMark = ({ compact, className, to }: BrandMarkProps) => {
  const classes = cn(
    "brand-mark inline-flex items-center",
    className,
  );

  const content = (
    <div className={cn("flex items-center gap-0.5 font-black tracking-tighter text-black uppercase", compact ? "text-xl" : "text-2xl")}>
      <span className="relative inline-block">
        H
        <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-[#00FF00] shadow-[0_0_10px_rgba(0,255,0,0.8)]" />
      </span>
      <span>YPE</span>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className={classes} aria-label="HYPE">
        {content}
      </Link>
    );
  }

  return (
    <div className={classes} aria-label="HYPE">
      {content}
    </div>
  );
};
