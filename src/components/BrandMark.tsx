import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  animated?: boolean;
  compact?: boolean;
  className?: string;
  to?: string;
  inverted?: boolean;
};

export const BrandMark = ({ compact, className, to, inverted }: BrandMarkProps) => {
  const classes = cn(
    "brand-mark inline-flex items-center",
    className,
  );

  const content = (
    <div className={cn(
      "font-display inline-flex items-baseline gap-2 uppercase leading-none",
      compact ? "text-xl" : "text-2xl",
      inverted ? "text-white" : "text-black"
    )}>
      <span className="relative font-black tracking-[-0.02em]">
        HYPE
        <span className="absolute -right-2 -top-1 h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_14px_rgba(182,255,0,0.95)]" />
      </span>
      {!compact && (
        <span className={cn(
          "hidden text-[0.48em] font-black tracking-[0.42em] sm:inline-block",
          inverted ? "text-white/70" : "text-muted-foreground"
        )}>
          DELIVERY
        </span>
      )}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className={classes} aria-label="Hype Delivery">
        {content}
      </Link>
    );
  }

  return (
    <div className={classes} aria-label="Hype Delivery">
      {content}
    </div>
  );
};
