import { cn } from "@/lib/utils";

interface MahnstufeIndicatorProps {
  stufe: number;
  className?: string;
}

export const MahnstufeIndicator = ({ stufe, className }: MahnstufeIndicatorProps) => {
  return (
    <div className={cn("flex items-center space-x-1", className)}>
      {[1, 2, 3].map((level) => (
        <div
          key={level}
          className={cn(
            "w-6 h-8 rounded-md border transition-all duration-300 shadow-sm",
            level <= stufe
              ? level === 1
                ? "bg-ochre-400 border-ochre-300"
                : level === 2
                ? "bg-terracotta-500 border-terracotta-400"
                : "bg-brand border-crimson-700"
              : "bg-neutral-200 border-neutral-300"
          )}
        />
      ))}
    </div>
  );
};