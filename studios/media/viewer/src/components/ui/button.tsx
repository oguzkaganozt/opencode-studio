import { cva, type VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes } from "react"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full border text-xs font-semibold uppercase tracking-[0.14em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8ff32] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-[#c8ff32] bg-[#c8ff32] px-4 py-2 text-[#111310] hover:bg-[#dcff7c]",
        outline: "border-white/18 bg-white/[0.03] px-4 py-2 text-[#f2efe6] hover:border-white/38 hover:bg-white/[0.07]",
        ghost: "border-transparent px-3 py-2 text-[#9da397] hover:bg-white/[0.06] hover:text-[#f2efe6]",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

export function Button({ className, variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />
}
