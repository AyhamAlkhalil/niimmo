import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Zap, 
  Sparkles, 
  Send, 
  Trash2, 
  X,
  Bot,
  User
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ModernChatbotProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://kmtgzrnpitlslivdvlyq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttdGd6cm5waXRsc2xpdmR2bHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3OTQxNTgsImV4cCI6MjA2MjM3MDE1OH0.CG2MB4Wcb6Dex8cT75fd0CBspHF55eC11tAjgkmxfKA";
const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;

export function ModernChatbot({ isOpen, onClose }: ModernChatbotProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hallo! Ich bin Chilla, dein KI‑Assistent für die Immobilienverwaltung. Wie kann ich dir heute helfen?",
      timestamp: new Date(),
    }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Auto-focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputMessage.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const messageToSend = inputMessage.trim();
    setInputMessage("");
    setIsLoading(true);

    // Prepare messages for API (exclude welcome message if it's the only assistant message)
    const apiMessages = messages
      .filter(m => m.id !== "welcome" || messages.length > 1)
      .map(m => ({ role: m.role, content: m.content }));
    apiMessages.push({ role: "user", content: messageToSend });

    let assistantContent = "";

    try {
      let { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Nicht eingeloggt. Bitte melde dich zuerst an.");
      }

      const nowInSeconds = Math.floor(Date.now() / 1000);
      if ((session.expires_at ?? 0) <= nowInSeconds + 30) {
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshed.session?.access_token) {
          throw new Error("Sitzung abgelaufen. Bitte neu einloggen.");
        }
        session = refreshed.session;
      }

      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error("Sitzung abgelaufen oder nicht eingeloggt. Bitte neu anmelden.");
        }
        if (response.status === 429) {
          throw new Error("Zu viele Anfragen. Bitte kurz warten und erneut versuchen.");
        }
        if (response.status === 402) {
          throw new Error("AI-Kontingent aufgebraucht. Bitte Credits prüfen.");
        }
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      // Create initial assistant message
      const assistantMessageId = `assistant-${Date.now()}`;
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages(prev => prev.map(m => 
                m.id === assistantMessageId 
                  ? { ...m, content: assistantContent }
                  : m
              ));
            }
          } catch {
            // Incomplete JSON, put it back
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages(prev => prev.map(m => 
                m.id === assistantMessageId 
                  ? { ...m, content: assistantContent }
                  : m
              ));
            }
          } catch { /* ignore */ }
        }
      }

    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Konnte nicht mit dem KI-Service verbinden.";
      const isFetchError = errorText.toLowerCase().includes("failed to fetch");

      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: isFetchError
          ? "Verbindung zur Chat-Funktion fehlgeschlagen. Bitte Seite neu laden und erneut versuchen."
          : errorText,
        timestamp: new Date(),
      };

      setMessages(prev => {
        // Remove empty assistant message if exists
        const filtered = prev.filter(m => m.content !== "" || m.role !== "assistant");
        return [...filtered, errorMessage];
      });
      
      toast({
        title: "Verbindungsfehler",
        description: error instanceof Error ? error.message : "Konnte nicht mit dem KI-Service verbinden.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: "welcome-new",
        role: "assistant",
        content: "Chat wurde geleert. Wie kann ich dir helfen?",
        timestamp: new Date(),
      }
    ]);
    toast({
      title: "Chat geleert",
      description: "Alle Nachrichten wurden entfernt.",
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('de-DE', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 w-[450px] h-[580px] z-50 animate-scale-in">
      <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-border/70 bg-card shadow-dialog">
        {/* Kopf in Anthrazit mit Karminlinie statt rotem Verlauf (26.10.2026) */}
        <CardHeader className="relative flex-shrink-0 bg-neutral-900 p-4 text-neutral-50">
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-brand" aria-hidden="true" />
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
                <Sparkles className="h-4 w-4 text-crimson-300" />
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-display text-2xl font-normal leading-none">
                  Chilla
                  <Zap className="h-3.5 w-3.5 text-crimson-300" />
                </h3>
                <p className="mt-1 text-xs text-neutral-400">Dein KI‑Assistent</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                onClick={clearChat}
                variant="ghost"
                size="sm"
                className="h-8 w-8 rounded-full p-0 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                title="Chat leeren"
                aria-label="Chat leeren"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                onClick={onClose}
                variant="ghost"
                size="sm"
                className="h-8 w-8 rounded-full p-0 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Chilla schließen"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Messages */}
        <CardContent className="flex min-h-0 flex-1 flex-col bg-neutral-50/60 p-0">
          <ScrollArea ref={scrollAreaRef} className="flex-1 h-full p-4">
            <div className="space-y-4">
              {messages.map((message, index) => (
                <div
                  key={message.id}
                  className={`flex animate-fade-in ${
                    message.role === "user" ? 'justify-end' : 'justify-start'
                  }`}
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl p-3.5 transition-all duration-200 ${
                      message.role === "user"
                        ? 'rounded-br-md bg-primary text-primary-foreground shadow-md'
                        : 'rounded-bl-md border border-border/70 bg-card text-foreground shadow-sm'
                    }`}
                  >
                    <div className="flex items-start space-x-2">
                      {message.role === "assistant" && (
                        <Bot className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      )}
                      {message.role === "user" && (
                        <User className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{message.content}</p>
                        <p className="text-xs mt-2 opacity-70">
                          {formatTime(message.timestamp)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {isLoading && messages[messages.length - 1]?.content === "" && (
                <div className="flex justify-start animate-fade-in">
                  <div className="rounded-2xl rounded-bl-md border border-border/70 bg-card p-3.5 text-foreground shadow-sm">
                    <div className="flex items-center space-x-3">
                      <Bot className="h-4 w-4" />
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                      <span className="text-sm">Chilla denkt nach...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="border-t border-border/70 bg-card p-4">
            <div className="flex space-x-3">
              <Input
                ref={inputRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Frag Chilla etwas…"
                disabled={isLoading}
                className="h-11 flex-1 rounded-xl"
              />
              <Button
                onClick={sendMessage}
                disabled={!inputMessage.trim() || isLoading}
                size="icon"
                className="h-11 w-11 rounded-xl disabled:cursor-not-allowed"
                aria-label="Nachricht senden"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
