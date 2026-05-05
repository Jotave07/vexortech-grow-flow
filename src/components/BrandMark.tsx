import { Link } from "react-router-dom";
import { PRODUCT_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";
import vexorLogo from "@/assets/vexortech-logo-official.png";

type BrandMarkProps = {
  animated?: boolean;
  compact?: boolean;
  className?: string;
  to?: string;
};

export const BrandMark = ({ animated, compact, className, to }: BrandMarkProps) => {
  const classes = cn(
    "brand-mark inline-flex items-center",
    compact && "brand-mark--compact",
    animated && "brand-mark--animated",
    className,
  );

  const content = (
    <div className={cn("brand-logo-frame", compact && "brand-logo-frame--compact")}>
      <img 
        src={vexorLogo} 
        alt={PRODUCT_NAME} 
        className="brand-logo-image"
        loading="eager"
        decoding="async"
      />
    </div>
  );

  if (to) {
    return (
      <Link to={to} className={classes} aria-label={PRODUCT_NAME}>
        {content}
      </Link>
    );
  }

  return (
    <div className={classes} aria-label={PRODUCT_NAME}>
      {content}
    </div>
  );
};
