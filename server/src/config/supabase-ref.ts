function parseFromHost(hostname: string): string | null {
  const normalizedHost = hostname.trim().toLowerCase();
  const hostMatch = normalizedHost.match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
  if (hostMatch?.[1]) {
    return hostMatch[1];
  }

  return null;
}

function parseFromUsername(username: string): string | null {
  const normalizedUsername = decodeURIComponent(username).trim().toLowerCase();
  const usernameMatch = normalizedUsername.match(/^[a-z0-9_]+\.(?<ref>[a-z0-9]{20})$/);
  return usernameMatch?.groups?.ref ?? null;
}

export function extractSupabaseProjectRef(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const fromHost = parseFromHost(url.hostname);
    if (fromHost) {
      return fromHost;
    }

    if (url.hostname.endsWith('.pooler.supabase.com')) {
      const fromUser = parseFromUsername(url.username);
      if (fromUser) {
        return fromUser;
      }
    }
  } catch {
    return null;
  }

  return null;
}
