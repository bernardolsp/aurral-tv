import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { color } from './TvControls';

export default function MetadataLink({kind, name, style, onOpen}: {
  kind: 'artist' | 'album';
  name: string | null;
  style: StyleProp<TextStyle>;
  onOpen: (kind: 'artist' | 'album') => void;
}) {
  const [focused, setFocused] = useState(false);
  if (!name?.trim()) return null;
  if (name.trim().toLowerCase() === 'unknown ' + kind)
    return <Text numberOfLines={1} style={style}>{name}</Text>;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={'Open ' + kind + ': ' + name}
      onPress={() => onOpen(kind)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[s.link, focused && s.focus]}>
      <Text numberOfLines={1} style={[style, focused && s.focusText]}>{name}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  link: { alignSelf:'flex-start', maxWidth:'100%', paddingHorizontal:4, marginLeft:-4, borderRadius:4 },
  focus: { backgroundColor:color.ink },
  focusText: { color:color.dark, textDecorationLine:'underline' },
});
