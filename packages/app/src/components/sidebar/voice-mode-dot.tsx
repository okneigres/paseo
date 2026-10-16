import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { densityIconBox } from "@/styles/density";
import { STATUS_INDICATOR_DOT_SIZE } from "@/utils/status-indicator-geometry";

// The row's title line box: every leading visual centres inside it, so a status mark and this one
// land on the same rail.
const VOICE_MODE_DOT_BOX_HEIGHT = 20;

// One period, slow enough to read as breathing rather than as a blink.
const PULSE_PERIOD_MS = 1100;
// The dim end of the pulse. Held this high because the row has to keep saying "voice is running
// here" at every frame: the dot breathes, it never blinks out.
const PULSE_MIN_OPACITY = 0.35;
const PULSE_MIN_SCALE = 0.86;

/**
 * The mark on the sidebar row of the workspace that is running voice mode: a filled red dot that
 * pulses while the turn is live.
 *
 * The animation runs on the UI thread so a pulsing row does not re-render the list on every frame,
 * and it lives in this component alone — nothing pulses while voice mode is off, because nothing
 * mounts.
 *
 * The animated view carries no Unistyles style — the themed dot is nested inside it instead. A
 * theme-tracked style on a Reanimated view crashes on theme change; see `status-ring/frame.tsx`
 * and docs/unistyles.md.
 */
export function VoiceModeDot() {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: PULSE_PERIOD_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 1 - pulse.value * (1 - PULSE_MIN_OPACITY),
    transform: [{ scale: 1 - pulse.value * (1 - PULSE_MIN_SCALE) }],
  }));

  return (
    <View style={styles.box} testID="workspace-voice-mode-indicator">
      <Animated.View style={pulseStyle}>
        <View style={styles.dot} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    width: densityIconBox("md"),
    height: VOICE_MODE_DOT_BOX_HEIGHT,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: STATUS_INDICATOR_DOT_SIZE,
    height: STATUS_INDICATOR_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.red[500],
  },
}));
