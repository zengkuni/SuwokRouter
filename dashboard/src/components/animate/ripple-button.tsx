import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  children?: ReactNode;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
};

export function RippleButton({
  className,
  variant = "default",
  size = "default",
  children,
  disabled,
  type = "button",
  ...props
}: Props) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      className={cn(
        buttonVariants({ variant, size }),
        "cursor-pointer select-none",
        "transition-[background-color,border-color,color,opacity] duration-150 ease-out",
        disabled && "cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}
