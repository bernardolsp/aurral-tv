import * as SecureStore from 'expo-secure-store';
import { proxyHeaders, serverAddress, type Connection } from './connection';

const key = 'aurral-tv.device-session';
export async function getSession(): Promise<Connection | null> {
  const value = await SecureStore.getItemAsync(key);
  if (!value) return null;
  try {
    const session = JSON.parse(value);
    if (typeof session.token !== 'string' || !session.token) throw new Error();
    return { ...(typeof session.remoteKey === "string" && /^[a-f0-9]{64}$/.test(session.remoteKey) ? {remoteKey: session.remoteKey} : {}), serverUrl: serverAddress(session.serverUrl), token: session.token, customHeaders: proxyHeaders(session.customHeaders)};
  } catch {
    await SecureStore.deleteItemAsync(key);
    return null;
  }
}
export function saveSession(session: Connection) { return SecureStore.setItemAsync(key, JSON.stringify(session)); }
export function clearSession() { return SecureStore.deleteItemAsync(key); }
