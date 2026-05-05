import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border border-transparent text-sm font-semibold uppercase tracking-[0.08em] ring-offset-background transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-glow hover:-translate-y-0.5 hover:bg-primary/92",
        destructive: "bg-destructive text-destructive-foreground hover:-translate-y-0.5 hover:bg-destructive/92",
        outline: "border-border bg-card text-foreground hover:-translate-y-0.5 hover:border-primary hover:bg-secondary",
        secondary: "border-border bg-secondary text-secondary-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:bg-secondary/84",
        ghost: "border-border/0 bg-transparent text-muted-foreground hover:-translate-y-0.5 hover:border-border hover:bg-secondary hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        hero: "bg-black text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] border-2 border-black",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        xl: "h-14 px-8 text-base [&_svg]:size-5",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
