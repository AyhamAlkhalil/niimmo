import { useState, useEffect } from "react";
import { useCsvUploadProgress } from "@/hooks/useCsvUploadProgress";
import { Progress } from "@/components/ui/progress";
import { FileSpreadsheet, Clock, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CsvUploadProgressBar() {
  const { isProcessing, fileName, startTime, estimatedDurationSeconds, reset } = useCsvUploadProgress();
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!isProcessing || !startTime) {
      setProgress(0);
      setElapsedTime(0);
      setIsComplete(false);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      setElapsedTime(elapsed);
      
      // Calculate progress (max 95% until webhook response)
      const calculatedProgress = Math.min((elapsed / estimatedDurationSeconds) * 100, 95);
      setProgress(calculatedProgress);
    }, 1000);

    return () => clearInterval(interval);
  }, [isProcessing, startTime, estimatedDurationSeconds]);

  // Listen for completion
  useEffect(() => {
    if (!isProcessing && progress > 0 && !isComplete) {
      setIsComplete(true);
      setProgress(100);
      
      // Auto-hide after 5 seconds when complete
      const timeout = setTimeout(() => {
        reset();
        setIsComplete(false);
      }, 5000);
      
      return () => clearTimeout(timeout);
    }
  }, [isProcessing, progress, isComplete, reset]);

  if (!isProcessing && !isComplete) {
    return null;
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const remainingTime = Math.max(0, estimatedDurationSeconds - elapsedTime);

  return (
    <div className="fixed bottom-24 right-6 z-50 w-80 animate-in slide-in-from-right-5 duration-300">
      <div className={`
        rounded-xl shadow-2xl border overflow-hidden
        ${isComplete 
          ? 'bg-forest-50 border-forest-200' 
          : 'bg-ochre-50 border-ochre-200'
        }
      `}>
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isComplete ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <FileSpreadsheet className="h-5 w-5 text-amber-600 animate-pulse" />
            )}
            <span className={`font-semibold text-sm ${isComplete ? 'text-green-800' : 'text-amber-800'}`}>
              {isComplete ? 'CSV-Import abgeschlossen' : 'CSV wird verarbeitet...'}
            </span>
          </div>
          {isComplete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-green-600 hover:text-green-800 hover:bg-green-100"
              onClick={() => {
                reset();
                setIsComplete(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Content */}
        <div className="px-4 pb-4 space-y-3">
          {fileName && (
            <p className="text-xs text-muted-foreground truncate">
              Datei: {fileName}
            </p>
          )}

          {/* Progress Bar */}
          <Progress 
            value={progress} 
            className={`h-2 ${isComplete ? '[&>div]:bg-green-500' : '[&>div]:bg-amber-500'}`}
          />

          {/* Time Info */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Vergangen: {formatTime(elapsedTime)}</span>
            </div>
            {!isComplete && (
              <span>ca. {formatTime(remainingTime)} verbleibend</span>
            )}
            {isComplete && (
              <span className="text-green-600 font-medium">Fertig!</span>
            )}
          </div>

          {!isComplete && (
            <p className="text-xs text-amber-700 bg-amber-100/50 rounded-md px-2 py-1.5">
              ⏳ Die Zahlungen werden in n8n verarbeitet und zugeordnet. 
              Dies dauert etwa 10 Minuten.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
