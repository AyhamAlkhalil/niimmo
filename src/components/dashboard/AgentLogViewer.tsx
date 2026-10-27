import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  RefreshCw, Search, MessageSquare,
  AlertTriangle, Users, DollarSign, ChevronDown, ChevronUp
} from "lucide-react";
import { format, parseISO, subDays, startOfDay } from "date-fns";
import { de } from "date-fns/locale";
import type { Database } from "@/integrations/supabase/types";
import { Seitenkopf } from "@/components/dashboard/Seitenkopf";

type AgentLog = Database["public"]["Tables"]["agent_logs"]["Row"];

interface AgentLogViewerProps {
  onBack: () => void;
}

// Telegram-User-ID → Anzeigename (Fallback falls telegram_user_name fehlt)
const USER_MAP: Record<string, string> = {
  "5789749001": "Ayhan Yeyrek",
  "5297404626": "Dennis Mikyas",
  "8755806372": "Ayham Alkhalil",
};

const EVENT_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  user_message:  { label: "Nachricht",    icon: "👤", color: "bg-blue-100 text-blue-800 border-blue-200" },
  bot_reply:     { label: "Bot-Antwort",  icon: "🤖", color: "bg-green-100 text-green-800 border-green-200" },
  tool_call:     { label: "Tool-Aufruf",  icon: "🔧", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  tool_result:   { label: "Tool-Ergebnis",icon: "📊", color: "bg-purple-100 text-purple-800 border-purple-200" },
  error:         { label: "Fehler",       icon: "⚠️", color: "bg-red-100 text-red-800 border-red-200" },
  session_start: { label: "Session",      icon: "▶️", color: "bg-gray-100 text-gray-700 border-gray-200" },
  model_change:  { label: "Modell",       icon: "🔄", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
};

const USER_ROLE_COLORS: Record<string, string> = {
  gf:  "bg-blue-100 text-blue-800 border-blue-200",
  dev: "bg-gray-100 text-gray-700 border-gray-200",
};

function formatTs(iso: string) {
  return format(parseISO(iso), "dd.MM.yyyy HH:mm:ss", { locale: de });
}

function KpiCard({
  title, value, icon: Icon, valueClass, subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  valueClass?: string;
  subtitle?: string;
}) {
  return (
    <Card className="glass-card border-0">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium mb-1">{title}</p>
            <p className={`text-2xl font-bold ${valueClass ?? "text-gray-800"}`}>{value}</p>
            {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
          </div>
          <div className="p-2 rounded-lg bg-gray-50">
            <Icon className="h-5 w-5 text-gray-500" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExpandModal({ log, onClose }: { log: AgentLog; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{EVENT_TYPE_LABELS[log.event_type]?.icon ?? "📋"}</span>
            <span>{EVENT_TYPE_LABELS[log.event_type]?.label ?? log.event_type}</span>
            <span className="text-sm font-normal text-gray-500 ml-2">{formatTs(log.created_at)}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">User:</span> <span className="font-medium">{log.telegram_user_name ?? USER_MAP[log.telegram_user_id ?? ""] ?? log.telegram_user_id ?? "—"}</span></div>
            <div><span className="text-gray-500">Session:</span> <span className="font-mono text-xs">{log.session_id?.slice(0, 12) ?? "—"}</span></div>
            <div><span className="text-gray-500">Modell:</span> <span>{log.model ?? "—"}</span></div>
            <div><span className="text-gray-500">Dauer:</span> <span>{log.duration_ms != null ? `${log.duration_ms} ms` : "—"}</span></div>
            {log.tokens_in != null && <div><span className="text-gray-500">Tokens:</span> <span>{log.tokens_in} / {log.tokens_out}</span></div>}
            {log.tool_name && <div><span className="text-gray-500">Tool:</span> <span className="font-mono">{log.tool_name}</span></div>}
          </div>

          {log.content && (
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1">Inhalt</p>
              <pre className="text-sm whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100 overflow-auto max-h-48">{log.content}</pre>
            </div>
          )}

          {log.tool_output_preview && (
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1">Tool-Ausgabe (Vorschau)</p>
              <pre className="text-sm whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100 overflow-auto max-h-32">{log.tool_output_preview}</pre>
            </div>
          )}

          {log.error_message && (
            <div>
              <p className="text-xs text-red-500 font-medium mb-1">Fehlermeldung</p>
              <pre className="text-sm whitespace-pre-wrap bg-red-50 rounded-lg p-3 border border-red-100 overflow-auto">{log.error_message}</pre>
            </div>
          )}

          {log.raw_event && (
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1">raw_event (Debug)</p>
              <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100 overflow-auto max-h-60 font-mono">
                {JSON.stringify(log.raw_event, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AgentLogViewer({ onBack }: AgentLogViewerProps) {
  const queryClient = useQueryClient();

  // Filter state
  const [filterUser, setFilterUser] = useState<string>("alle");
  const [filterEventType, setFilterEventType] = useState<string>("alle");
  const [filterOnlyErrors, setFilterOnlyErrors] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedLog, setExpandedLog] = useState<AgentLog | null>(null);
  const [liveExpanded, setLiveExpanded] = useState(true);
  const liveLogsRef = useRef<AgentLog[]>([]);
  const [liveLogs, setLiveLogs] = useState<AgentLog[]>([]);

  // KPIs – letzte 24h
  const { data: kpis } = useQuery({
    queryKey: ["agent-logs-kpis"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("agent_logs")
        .select("event_type, telegram_user_id, is_error, tokens_in, tokens_out, estimated_cost_usd")
        .gte("created_at", since);
      if (error) throw error;
      const nachrichten = data.filter(r => r.event_type === "user_message").length;
      const errors = data.filter(r => r.is_error).length;
      const users = new Set(data.filter(r => r.event_type === "user_message").map(r => r.telegram_user_id)).size;
      const kosten = data.reduce((sum, r) => {
        if (r.estimated_cost_usd) return sum + Number(r.estimated_cost_usd);
        const i = r.tokens_in ?? 0;
        const o = r.tokens_out ?? 0;
        return sum + i * 0.00000025 + o * 0.000002;
      }, 0);
      return { nachrichten, errors, users, kosten };
    },
    refetchInterval: 30_000,
  });

  // Hauptliste
  const { data: logs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["agent-logs-list", filterUser, filterEventType, filterOnlyErrors],
    queryFn: async () => {
      let q = supabase
        .from("agent_logs")
        .select("id,created_at,event_type,direction,telegram_user_id,telegram_user_name,user_role,session_id,content,model,tokens_in,tokens_out,estimated_cost_usd,tool_name,tool_output_preview,duration_ms,is_error,error_message")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filterUser !== "alle") q = q.eq("telegram_user_id", filterUser);
      if (filterEventType !== "alle") q = q.eq("event_type", filterEventType);
      if (filterOnlyErrors) q = q.eq("is_error", true);

      const { data, error } = await q;
      if (error) throw error;
      return data as AgentLog[];
    },
    refetchInterval: 30_000,
  });

  // Charts – letzte 7 Tage
  const { data: chartData } = useQuery({
    queryKey: ["agent-logs-charts"],
    queryFn: async () => {
      const since = subDays(startOfDay(new Date()), 6).toISOString();
      const { data, error } = await supabase
        .from("agent_logs")
        .select("created_at,event_type,user_role,telegram_user_name,tokens_in,tokens_out,tool_name")
        .gte("created_at", since);
      if (error) throw error;

      // Messages pro Tag (letzte 7 Tage)
      const dayMap: Record<string, { gf: number; dev: number }> = {};
      for (let i = 6; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "dd.MM");
        dayMap[d] = { gf: 0, dev: 0 };
      }
      data.filter(r => r.event_type === "user_message").forEach(r => {
        const d = format(parseISO(r.created_at), "dd.MM");
        if (dayMap[d]) {
          const role = r.user_role === "dev" ? "dev" : "gf";
          dayMap[d][role]++;
        }
      });
      const messagesPerDay = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }));

      // Tokens pro User
      const tokenMap: Record<string, { name: string; tokens_in: number; tokens_out: number }> = {};
      data.filter(r => r.telegram_user_name).forEach(r => {
        const key = r.telegram_user_name!;
        if (!tokenMap[key]) tokenMap[key] = { name: key.split(" ")[0], tokens_in: 0, tokens_out: 0 };
        tokenMap[key].tokens_in += r.tokens_in ?? 0;
        tokenMap[key].tokens_out += r.tokens_out ?? 0;
      });
      const tokensPerUser = Object.values(tokenMap);

      // Häufigste Tools
      const toolMap: Record<string, number> = {};
      data.filter(r => r.event_type === "tool_call" && r.tool_name).forEach(r => {
        toolMap[r.tool_name!] = (toolMap[r.tool_name!] ?? 0) + 1;
      });
      const topTools = Object.entries(toolMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
        .map(([name, value]) => ({ name, value }));

      return { messagesPerDay, tokensPerUser, topTools };
    },
    refetchInterval: 60_000,
  });

  // Vollständiger Log inkl. raw_event – nur bei Bedarf
  const loadFullLog = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("agent_logs")
      .select("*")
      .eq("id", id)
      .single();
    if (!error && data) setExpandedLog(data as AgentLog);
  }, []);

  // Realtime Live-Stream
  useEffect(() => {
    liveLogsRef.current = [];
    setLiveLogs([]);

    const channel = supabase
      .channel("agent-logs-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_logs" },
        (payload) => {
          const newLog = payload.new as AgentLog;
          liveLogsRef.current = [newLog, ...liveLogsRef.current].slice(0, 10);
          setLiveLogs([...liveLogsRef.current]);
          queryClient.invalidateQueries({ queryKey: ["agent-logs-kpis"] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Client-seitige Volltext-Suche
  const filtered = logs?.filter(log => {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return (
      log.content?.toLowerCase().includes(t) ||
      log.telegram_user_name?.toLowerCase().includes(t) ||
      log.tool_name?.toLowerCase().includes(t) ||
      log.event_type.toLowerCase().includes(t)
    );
  });

  const getUserName = (log: AgentLog) =>
    log.telegram_user_name ?? USER_MAP[log.telegram_user_id ?? ""] ?? log.telegram_user_id ?? "—";

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <div className="mx-auto max-w-[1400px] px-4 pb-12 sm:px-6 lg:px-10">

        <Seitenkopf
          bereich="System"
          titel="Chilla Agent-Logs"
          beschreibung="Telegram-Bot Interaktionen · Live-Monitoring"
          onZurueck={onBack}
          aktionen={
            <Button
              variant="ghost" size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Aktualisieren"
              className="text-gray-500 hover:text-gray-800"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          }
        />

        {/* KPI-Cards */}
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <KpiCard
            title="Nachrichten heute"
            value={kpis?.nachrichten ?? "—"}
            icon={MessageSquare}
          />
          <KpiCard
            title="Aktive User (24h)"
            value={kpis?.users ?? "—"}
            icon={Users}
          />
          <KpiCard
            title="Kosten heute (USD)"
            value={kpis ? `$${kpis.kosten.toFixed(4)}` : "—"}
            icon={DollarSign}
            subtitle="geschätzt"
          />
          <KpiCard
            title="Fehler (24h)"
            value={kpis?.errors ?? "—"}
            icon={AlertTriangle}
            valueClass={kpis && kpis.errors > 0 ? "text-red-600" : "text-gray-800"}
          />
        </div>

        {/* Live-Stream Panel */}
        <div className="glass-card rounded-xl mb-6 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            onClick={() => setLiveExpanded(v => !v)}
          >
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span>Live-Stream (Realtime)</span>
              {liveLogs.length > 0 && (
                <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">{liveLogs.length} neu</Badge>
              )}
            </div>
            {liveExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {liveExpanded && (
            <div className="px-4 pb-3 space-y-2 max-h-48 overflow-y-auto">
              {liveLogs.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">Warte auf neue Events …</p>
              ) : liveLogs.map(log => (
                <div
                  key={log.id}
                  className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity border ${log.is_error ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-100"}`}
                  onClick={() => loadFullLog(log.id)}
                >
                  <span className="shrink-0 mt-0.5">{EVENT_TYPE_LABELS[log.event_type]?.icon ?? "📋"}</span>
                  <span className="text-gray-500 shrink-0">{format(parseISO(log.created_at), "HH:mm:ss")}</span>
                  <span className="font-medium text-gray-700 shrink-0">{getUserName(log)}</span>
                  <span className="text-gray-600 truncate">{log.content ?? log.tool_name ?? log.event_type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filter-Leiste */}
        <div className="glass-card rounded-xl p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Volltext-Suche …"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-sm bg-white/80"
              />
            </div>

            <Select value={filterUser} onValueChange={setFilterUser}>
              <SelectTrigger className="h-9 text-sm w-full sm:w-44 bg-white/80">
                <SelectValue placeholder="Alle User" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle User</SelectItem>
                <SelectItem value="5789749001">Ayhan Yeyrek</SelectItem>
                <SelectItem value="5297404626">Dennis Mikyas</SelectItem>
                <SelectItem value="8755806372">Ayham Alkhalil</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterEventType} onValueChange={setFilterEventType}>
              <SelectTrigger className="h-9 text-sm w-full sm:w-44 bg-white/80">
                <SelectValue placeholder="Event-Typ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Event-Typen</SelectItem>
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-white/80">
              <Switch
                id="only-errors"
                checked={filterOnlyErrors}
                onCheckedChange={setFilterOnlyErrors}
                className="scale-90"
              />
              <Label htmlFor="only-errors" className="text-sm cursor-pointer whitespace-nowrap">Nur Fehler</Label>
            </div>
          </div>
        </div>

        {/* Haupt-Tabelle */}
        <div className="glass-card rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-gray-400 mr-3" />
              <span className="text-gray-500">Lade Logs …</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-100 bg-gray-50/60">
                    <TableHead className="text-xs font-semibold text-gray-600 whitespace-nowrap w-36">Zeit</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 w-32">User</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 w-28">Event</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600">Inhalt</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 text-right w-24">Tokens</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-400 py-10">
                        Keine Einträge gefunden.
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered?.map(log => {
                    const evCfg = EVENT_TYPE_LABELS[log.event_type];
                    const rowClass = log.is_error
                      ? "bg-red-50/60 hover:bg-red-50 border-red-100"
                      : "hover:bg-gray-50/60 border-gray-50";

                    return (
                      <TableRow key={log.id} className={`border-b ${rowClass} transition-colors`}>
                        <TableCell className="text-xs text-gray-500 font-mono whitespace-nowrap py-3">
                          {formatTs(log.created_at)}
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-gray-800 leading-tight">{getUserName(log)}</span>
                            {log.user_role && (
                              <Badge variant="outline" className={`text-xs px-1.5 py-0 h-4 w-fit ${USER_ROLE_COLORS[log.user_role] ?? "bg-gray-100 text-gray-600"}`}>
                                {log.user_role === "gf" ? "GF" : log.user_role === "dev" ? "Dev" : log.user_role}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <Badge variant="outline" className={`text-xs gap-1 ${evCfg?.color ?? "bg-gray-100 text-gray-700"}`}>
                            <span>{evCfg?.icon ?? "📋"}</span>
                            <span>{evCfg?.label ?? log.event_type}</span>
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 max-w-xs">
                          <p className="text-xs text-gray-700 line-clamp-3 leading-relaxed">
                            {log.content ?? log.tool_name ?? log.tool_output_preview ?? <span className="text-gray-400 italic">—</span>}
                          </p>
                          {log.is_error && log.error_message && (
                            <p className="text-xs text-red-600 mt-1 truncate">{log.error_message}</p>
                          )}
                        </TableCell>
                        <TableCell className="py-3 text-right">
                          {(log.tokens_in != null || log.tokens_out != null) ? (
                            <div className="text-right">
                              <span className="text-xs text-blue-600">{log.tokens_in ?? 0}</span>
                              <span className="text-xs text-gray-400 mx-0.5">→</span>
                              <span className="text-xs text-green-600">{log.tokens_out ?? 0}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-gray-400 hover:text-gray-700"
                            onClick={() => loadFullLog(log.id)}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
            {filtered?.length ?? 0} Einträge · letzte 100 · alle 30 s aktualisiert
          </div>
        </div>
        {/* Charts-Sektion */}
        {chartData && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Messages pro Tag */}
            <Card className="glass-card border-0 lg:col-span-2">
              <CardContent className="p-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Nachrichten pro Tag (7 Tage)</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData.messagesPerDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eae6e3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="gf" name="Geschäftsführer" stroke="#4b6c9f" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="dev" name="Entwickler" stroke="#78726f" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Häufigste Tools */}
            <Card className="glass-card border-0">
              <CardContent className="p-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Tool-Aufrufe (7 Tage)</p>
                {chartData.topTools.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">Keine Tool-Aufrufe</p>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={chartData.topTools}
                        cx="50%"
                        cy="50%"
                        outerRadius={65}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                        fontSize={10}
                      >
                        {chartData.topTools.map((_, i) => (
                          <Cell key={i} fill={["#4b6c9f","#55956e","#c88a28","#be2637","#7b80b6","#78726f"][i % 6]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Tokens pro User */}
            {chartData.tokensPerUser.length > 0 && (
              <Card className="glass-card border-0 lg:col-span-3">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">Token-Verbrauch pro User (7 Tage)</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={chartData.tokensPerUser} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#eae6e3" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="tokens_in" name="Tokens In" stackId="a" fill="#4b6c9f" />
                      <Bar dataKey="tokens_out" name="Tokens Out" stackId="a" fill="#55956e" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
        )}

      </div>

      {/* Expand-Modal */}
      {expandedLog && (
        <ExpandModal log={expandedLog} onClose={() => setExpandedLog(null)} />
      )}
    </div>
  );
}
