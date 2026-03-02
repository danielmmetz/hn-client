let cachedUser = undefined; // undefined = not checked, null = not logged in, object = user
let cachedAuthConfig = undefined; // undefined = not checked, object = { enabled, required }

export async function fetchAuthConfig() {
  try {
    const resp = await fetch('/api/auth/config');
    if (resp.ok) {
      cachedAuthConfig = await resp.json();
      return cachedAuthConfig;
    }
    cachedAuthConfig = { enabled: false, required: false };
    return cachedAuthConfig;
  } catch {
    cachedAuthConfig = { enabled: false, required: false };
    return cachedAuthConfig;
  }
}

export function getCachedAuthConfig() {
  return cachedAuthConfig;
}

export async function fetchUser() {
  try {
    const resp = await fetch('/api/auth/me');
    if (resp.ok) {
      cachedUser = await resp.json();
      return cachedUser;
    }
    cachedUser = null;
    return null;
  } catch {
    cachedUser = null;
    return null;
  }
}

export function getCachedUser() {
  return cachedUser;
}

export function login() {
  window.location.href = '/api/auth/login';
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
  cachedUser = null;
  window.location.href = '/';
}
