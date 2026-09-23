import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// In het thema Fel is elke knop een ronde pil: oranje voor de knop waar het om
// gaat, rustig voor de rest, en een dikkere oranje ring als je er met Tab op
// staat. In Zakelijk is hij ook een pil, maar dan bijna zwart en zonder
// schaduw — één donkere knop per scherm, de rest heeft alleen een randje.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 fel:rounded-full fel:focus-visible:ring-2 fel:focus-visible:ring-offset-2 fel:focus-visible:ring-offset-background zak:rounded-full zak:focus-visible:ring-2 zak:focus-visible:ring-offset-2 zak:focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90 fel:font-semibold fel:shadow-none zak:font-semibold zak:shadow-sm",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 fel:bg-tint-rood fel:text-[#3b0a05] fel:font-semibold fel:shadow-none fel:hover:bg-tint-rood/90 zak:shadow-none",
        outline:
          "bg-card shadow-card hover:bg-card-header hover:text-foreground fel:border fel:border-border fel:bg-transparent fel:shadow-none fel:hover:bg-accent zak:border zak:border-border zak:shadow-none zak:hover:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 fel:shadow-none zak:shadow-none",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline fel:rounded-none zak:rounded-none",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
