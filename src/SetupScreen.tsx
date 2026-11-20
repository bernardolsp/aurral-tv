import React, { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Setup } from './connection';
import PhoneSetup from './PhoneSetup';
import { Brand, Button, color } from './TvControls';

function Entry({
  label,
  value,
  onChange,
  code,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  code?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        autoCapitalize={code ? 'characters' : 'none'}
        keyboardType={code ? 'default' : 'url'}
        placeholder={code ? '10-character code' : 'https://your-server'}
        placeholderTextColor={color.muted}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[s.input, focus && s.inputFocus]}
      />
    </View>
  );
}

export default function SetupScreen({
  onPair,
  remote = false,
  onBack,
}: {
  onPair: (setup: Setup, acknowledge?: () => Promise<void>) => Promise<void>;
  remote?: boolean;
  onBack?: () => void;
}) {
  const [serverUrl, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!manual) return false;
      setManual(false);
      return true;
    });
    return () => sub.remove();
  }, [manual]);

  async function submit() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await onPair({ serverUrl, code, customHeaders: {} });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Aurral.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.top}>
        <Brand />
        {onBack && <Button label="Back" icon="back" onPress={onBack} />}
      </View>
      <View style={s.columns}>
        <View style={s.intro}>
          <Text accessibilityRole="header" style={s.title}>
            {manual ? 'Pair with a code' : remote ? 'Pair Pocket remote' : 'Set up Aurral TV'}
          </Text>
          <Text style={s.introText}>
            {manual
              ? 'In Aurral, open Settings → Profile → Pair a device to get your code.'
              : remote
                ? 'Connect Pocket on the same Wi-Fi to send music to this TV.'
                : 'Connect to your Aurral server to play your playlists and Flows on the big screen.'}
          </Text>
          {!manual && !remote && (
            <View style={s.alternative}>
              <Button label="Enter server and pairing code" icon="code" onPress={() => setManual(true)} />
            </View>
          )}
        </View>
        <View style={s.panel}>
          {manual ? (
            <>
              <Entry label="Server address" value={serverUrl} onChange={setUrl} />
              <Entry label="Pairing code" value={code} onChange={setCode} code />
              {!!error && (
                <Text accessibilityLiveRegion="polite" style={s.notice}>
                  {error}
                </Text>
              )}
              <View style={s.buttons}>
                <Button
                  label={busy ? 'Pairing…' : 'Pair TV'}
                  primary
                  disabled={busy}
                  onPress={() => void submit()}
                />
                <Button label="Use Pocket" onPress={() => setManual(false)} />
              </View>
            </>
          ) : (
            <PhoneSetup onReceive={onPair} />
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, paddingHorizontal: '5%', paddingVertical: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  columns: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 36, paddingVertical: 15 },
  intro: { flex: 1.05, gap: 14 },
  title: { fontSize: 44, lineHeight: 47, fontWeight: '800', letterSpacing: -1.8, color: color.ink },
  introText: { fontSize: 19, lineHeight: 26, color: color.secondary, maxWidth: 420 },
  alternative: { alignSelf: 'flex-start', marginTop: 8 },
  panel: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: color.surface,
    padding: 24,
    gap: 14,
    borderWidth: 1,
    borderColor: color.border,
  },
  field: { gap: 5 },
  label: { color: color.ink, fontWeight: '600', fontSize: 15 },
  input: {
    backgroundColor: color.bg,
    borderWidth: 2,
    borderColor: color.border,
    borderRadius: 8,
    color: color.ink,
    fontSize: 17,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  inputFocus: { borderColor: color.lime },
  buttons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  notice: { color: color.error, fontSize: 15 },
});
