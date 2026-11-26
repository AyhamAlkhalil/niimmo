// Die Regeln zu den Zählerarten liegen seit dem 26.11.2026 in supabase/functions/_shared/zaehlerarten.ts, damit der
// MCP-Server (Edge Function mcp) dieselben nutzt; aus Deno ist src/ nicht importierbar (CLAUDE.md).
export * from '../../supabase/functions/_shared/zaehlerarten.ts';
