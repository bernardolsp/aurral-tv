import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { requireNativeModule } from 'expo';
import Svg, { Path, Rect } from 'react-native-svg';
import QRCode from 'qrcode';
import { getRandomValues } from 'expo-crypto';
import type { Setup } from './connection';
import { openPhoneSetup, phoneSetupKeys, phoneSetupLink } from './phoneSetupProtocol';

type Inbox = {
  open(id: string): Promise<{ address: string; port: number }>;
  receive(id: string): Promise<string>;
  finish(id: string, accepted: boolean): Promise<boolean>;
  close(id: string): Promise<void>;
};
const inbox = requireNativeModule<Inbox>('AurralPhoneSetup');

function ScanCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const runs: string[] = [];
    for (let y = 0; y < modules.size; y++) {
      let x = 0;
      while (x < modules.size) {
        if (!modules.get(y, x)) { x++; continue; }
        const start = x++;
        while (x < modules.size && modules.get(y, x)) x++;
        const width = x - start;
        runs.push(`M${start + 4} ${y + 4}h${width}v1h-${width}z`);
      }
    }
    return { size: modules.size + 8, path: runs.join('') };
  }, [value]);
  return <Svg width={200} height={200} viewBox={`0 0 ${size} ${size}`}>
    <Rect width={size} height={size} fill="white" /><Path d={path} fill="black" />
  </Svg>;
}

export default function PhoneSetup({ onReceive }: { onReceive: (setup: Setup) => Promise<void> }) {
  const active = useRef<ReturnType<typeof phoneSetupKeys> | null>(null);
  const mounted = useRef(false);
  const [qr, setQr] = useState<{ url: string; fingerprint: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [focused, setFocused] = useState(false);
  function stop() {
    const keys = active.current;
    active.current = null;
    if (keys) {
      keys.privateKey.fill(0);
      void inbox.close(keys.id).catch(() => {});
    }
    if (mounted.current) { setQr(null); setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') stop(); });
    return () => { mounted.current = false; sub.remove(); stop(); };
  }, []);

  async function start() {
    if (active.current || busy) return;
    let keys: ReturnType<typeof phoneSetupKeys>;
    try { keys = phoneSetupKeys(getRandomValues); }
    catch { setMessage('Could not start secure pairing. Try again.'); return; }
    active.current = keys;
    setBusy(true);
    setMessage('');
    try {
      const listener = await inbox.open(keys.id);
      if (active.current !== keys) { await inbox.close(keys.id); return; }
      setQr({ url: phoneSetupLink(keys, listener.address, listener.port), fingerprint: keys.fingerprint });
      while (active.current === keys) {
        const sealed = await inbox.receive(keys.id);
        if (active.current !== keys) return;
        let setup: Setup;
        try { setup = openPhoneSetup(sealed, keys); }
        catch { await inbox.finish(keys.id, false); continue; }
        if (!await inbox.finish(keys.id, true)) throw new Error('Pairing expired');
        if (active.current !== keys) return;
        keys.privateKey.fill(0);
        setQr(null);
        setMessage('Connecting to your server…');
        await onReceive(setup);
        return;
      }
    } catch {
      if (active.current === keys && mounted.current) {
        setMessage('Could not finish pairing. Check both devices are on the same network and try again.');
      }
    } finally {
      if (active.current === keys) stop();
    }
  }

  return <View style={s.container}>
    {qr && <>
      <ScanCode value={qr.url} />
      <Text style={s.description}>Scan with your phone camera. Match this code in Pocket.</Text>
      <Text style={s.fingerprint}>{qr.fingerprint}</Text>
    </>}
    {message ? <Text accessibilityLiveRegion="polite" style={s.description}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy && !qr} onPress={qr ? stop : start}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[s.button, focused && s.focus]}>
      <Text style={[s.label, focused && s.focusLabel]}>{qr ? 'Cancel pairing' : 'Pair with Pocket'}</Text>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  container: { alignItems: 'flex-start', gap: 9 },
  description: { color: '#bac1c6', fontSize: 16, maxWidth: 320 },
  fingerprint: { color: '#fff', fontSize: 19, letterSpacing: 2 },
  button: { borderRadius: 10, backgroundColor: '#263034', paddingHorizontal: 18, paddingVertical: 11 },
  focus: { backgroundColor: '#c2f3df' },
  label: { color: '#e6f3ed', fontSize: 16, fontWeight: '600' },
  focusLabel: { color: '#12231a' },
});
