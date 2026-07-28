import { cva, type VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes } from "react"
import { cn } from "../lib/cn"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--osc-radius-md)] border text-[12px] font-medium tracking-wide transition-[background-color,border-color,color,opacity,box-shadow,transform] duration-[var(--osc-motion-duration)] ease-out focus-visible:outline-none focus-visible:shadow-[var(--osc-focus-ring)] active:scale-[0.98] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "border-[var(--osc-primary)] bg-[var(--osc-primary)] px-4 py-2 text-[var(--osc-primary-fg)] hover:bg-[var(--osc-primary-hover)]",
        outline:
          "border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)] px-4 py-2 text-[var(--osc-text)] hover:bg-[var(--osc-surface)]",
        ghost: "border-transparent px-3 py-2 text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface)] hover:text-[var(--osc-text)]",
        danger: "border-[var(--osc-error)] bg-[var(--osc-error)] px-4 py-2 text-white hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-[12px]",
        md: "h-9 px-4 text-[12px]",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
