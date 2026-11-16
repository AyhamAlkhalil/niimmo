import { describe, expect, it } from 'vitest';
import { gueltigeAutorisierungsId, leseAutorisierung, ruecksprungErlaubt, zustimmungsPfad } from './oauthZustimmung';

describe('Zustimmung zum MCP-Zugang', () => {
  it('lässt einen Code nur an Claude zurückgehen', () => {
    expect(ruecksprungErlaubt('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(ruecksprungErlaubt('https://claude.com/api/mcp/auth_callback')).toBe(true);
    expect(ruecksprungErlaubt('http://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(ruecksprungErlaubt('https://claude.ai.boese.de/cb')).toBe(false);
    expect(ruecksprungErlaubt('https://boese.de/claude.ai')).toBe(false);
    expect(ruecksprungErlaubt('https://claude.ai@boese.de/cb')).toBe(false);
    expect(ruecksprungErlaubt('https://x:y@claude.ai/cb')).toBe(false);
    expect(ruecksprungErlaubt('kein url')).toBe(false);
    // nur der Callback, nicht irgendeine Seite und kein anderer Port
    expect(ruecksprungErlaubt('https://claude.ai/irgendwo')).toBe(false);
    expect(ruecksprungErlaubt('https://claude.ai:8443/api/mcp/auth_callback')).toBe(false);
    expect(ruecksprungErlaubt('https://claude.ai/api/mcp/auth_callback?code=x&state=y')).toBe(true);
    expect(ruecksprungErlaubt(null)).toBe(false);
  });

  it('nimmt nur unverdächtige Anfrage-IDs und baut den Rücksprung nach der Anmeldung', () => {
    expect(gueltigeAutorisierungsId('a1b2c3d4-e5f6')).toBe(true);
    expect(gueltigeAutorisierungsId('../../x')).toBe(false);
    expect(gueltigeAutorisierungsId('kurz')).toBe(false);
    expect(gueltigeAutorisierungsId(42)).toBe(false);
    expect(zustimmungsPfad('abc_DEF-123')).toBe('/oauth/consent?authorization_id=abc_DEF-123');
  });

  it('unterscheidet „Zustimmung nötig“ von „schon zugestimmt“', () => {
    expect(leseAutorisierung({
      authorization_id: 'abc12345',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      client: { id: 'c1', name: ' Claude ' },
      user: { id: 'u1', email: 'a@b.de' },
      scope: 'email',
    })).toEqual({
      art: 'zustimmung',
      details: {
        authorization_id: 'abc12345',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        client: { id: 'c1', name: 'Claude', uri: null, logo_uri: null },
        user: { id: 'u1', email: 'a@b.de' },
        scope: 'email',
      },
    });
    expect(leseAutorisierung({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=x' }))
      .toEqual({ art: 'weiter', redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=x' });
    expect(leseAutorisierung({ client: {} })).toBeNull();
    expect(leseAutorisierung(null)).toBeNull();
  });
});
