import langflowAssistantIcon from "@/assets/langflow_assistant.svg";
import { cn } from "@/utils/utils";
import { AssistantPanel } from "./assistant-panel";

interface AssistantWidgetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function AssistantWidget({
  isOpen,
  onOpenChange,
}: AssistantWidgetProps) {
  return (
    <>
      <AssistantPanel isOpen={isOpen} onClose={() => onOpenChange(false)} />

      <div className="fixed right-4 bottom-4 z-50 md:right-6 md:bottom-6">
        <button
          type="button"
          data-testid="assistant-button"
          data-assistant-widget-launcher
          onClick={() => onOpenChange(!isOpen)}
          className={cn(
            "group flex items-center gap-3 rounded-full border border-border/80 bg-background/95 px-3 py-3 text-left shadow-[0_24px_80px_-32px_rgba(15,23,42,0.6)] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-[0_28px_90px_-34px_rgba(15,23,42,0.68)]",
            isOpen && "border-emerald-200 bg-background",
          )}
          aria-expanded={isOpen}
          aria-controls="assistant-panel"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-950 ring-1 ring-white/10">
            <img
              src={langflowAssistantIcon}
              alt="Ассистент"
              className="h-full w-full object-cover"
            />
          </span>
          <span className="hidden min-w-0 sm:flex sm:flex-col">
            <span className="text-sm font-semibold leading-4 text-foreground">
              Ассистент-Копилот
            </span>
            <span className="text-xs leading-4 text-muted-foreground">
              Опишите флоу
            </span>
          </span>
          <span className="hidden rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 sm:inline-flex">
            {isOpen ? "Закрыть" : "Чат"}
          </span>
        </button>
      </div>
    </>
  );
}

export default AssistantWidget;
