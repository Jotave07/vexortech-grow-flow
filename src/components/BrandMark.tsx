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
    <div className={cn("flex items-center gap-0.5 font-black tracking-tighter text-black", compact ? "text-xl" : "text-2xl")}>
      <span className="relative">
        H
        <span className="absolute -right-0.5 top-1 h-1.5 w-1.5 rounded-full bg-[#00FF00]" />
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
