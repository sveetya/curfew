import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Sonner, dressed in this app's tokens.
 *
 * Mounted once per window. Toasts are for things that finish and need
 * acknowledging — a save, an update, a refused key — never for things the
 * screen already shows (the countdown does not toast).
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      closeButton
      duration={5000}
      icons={{
        success: <IconCircleCheck size={16} stroke={1.9} />,
        info: <IconInfoCircle size={16} stroke={1.9} />,
        warning: <IconAlertTriangle size={16} stroke={1.9} />,
        error: <IconX size={16} stroke={1.9} />,
        loading: <IconLoader2 size={16} stroke={1.9} className="animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!bg-popover !text-foreground !border !border-border !rounded-[var(--radius-sm)] !shadow-lg !font-sans",
          title: "!text-sm !font-medium",
          description: "!text-xs !text-muted-foreground",
          actionButton: "!bg-primary-ink !text-[#06101c] !text-xs !font-semibold !rounded-md",
          cancelButton: "!bg-muted !text-muted-foreground !text-xs !rounded-md",
          closeButton: "!bg-transparent !text-muted-foreground !border-border",
        },
      }}
      {...props}
    />
  );
}
