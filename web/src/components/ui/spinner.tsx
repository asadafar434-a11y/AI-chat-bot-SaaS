import { cn } from "cn"
import { RefreshIcon } from "@/components/icons"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <RefreshIcon data-slot="spinner" role="status" aria-label="Загрузка" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
