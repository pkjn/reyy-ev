import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, PermissionsAndroid } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";

import * as IntentLauncher from "expo-intent-launcher";
import { setOnboardingComplete } from "../services/auth";
import * as Device from "expo-device";

const STEPS = ["permissions", "battery", "autostart"];

export default function OnboardingScreen() {
  const [stepIndex, setStepIndex] = useState(0);
  const router = useRouter();

  const step = STEPS[stepIndex];

  const handleNext = async () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      await setOnboardingComplete();
      router.replace("/home");
    }
  };

  const handlePermissions = async () => {
    // 1. Foreground Location
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== "granted") {
      alert("Foreground location permission is required.");
      return;
    }
    
    // 2. Background Location
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== "granted") {
      alert("Background location permission is required for live tracking.");
      return;
    }

    // 3. Notifications (Android 13+)
    // Required to start a foreground service.
    if (Platform.OS === "android" && Platform.Version >= 33) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        alert("Notification permission is required for background tracking.");
        return;
      }
    }

    handleNext();
  };

  const handleBattery = async () => {
    if (Platform.OS === "android") {
      try {
        // Try to open battery optimization settings
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS
        );
      } catch (e) {
        console.warn("Could not open battery optimization settings", e);
      }
    }
    handleNext();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Setup Needed</Text>
        <Text style={styles.subtitle}>Step {stepIndex + 1} of {STEPS.length}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {step === "permissions" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Location & Notifications</Text>
            <Text style={styles.cardText}>
              We need "Always Allow" location access to track the scooty while the screen is off, and notification permission to keep the service running.
            </Text>
            <TouchableOpacity style={styles.button} onPress={handlePermissions}>
              <Text style={styles.buttonText}>Grant Permissions</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "battery" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Battery Optimization</Text>
            <Text style={styles.cardText}>
              Android might kill the live tracker to save battery.
            </Text>
            <Text style={styles.cardText}>
              On the next screen, find "Reyy EV" and set it to <Text style={{fontWeight: "bold"}}>"Unrestricted"</Text> or <Text style={{fontWeight: "bold"}}>"Don't Optimize"</Text>.
            </Text>
            <TouchableOpacity style={styles.button} onPress={handleBattery}>
              <Text style={styles.buttonText}>Open Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.outlineButton} onPress={handleNext}>
              <Text style={styles.outlineButtonText}>I've already done this</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "autostart" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Autostart (Important)</Text>
            <Text style={styles.cardText}>
              Device: {Device.manufacturer}
            </Text>
            <Text style={styles.cardText}>
              Some phones (like Xiaomi, Vivo, Oppo) prevent apps from running in the background. You must manually enable Autostart.
            </Text>
            <View style={styles.instructionBox}>
              <Text style={styles.instructionText}>
                1. Go to your phone's Settings{"\n"}
                2. Apps → Manage Apps{"\n"}
                3. Find "Reyy EV"{"\n"}
                4. Enable "Autostart"
              </Text>
            </View>
            <TouchableOpacity style={styles.button} onPress={handleNext}>
              <Text style={styles.buttonText}>I've enabled Autostart</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 24,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
  },
  content: {
    padding: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 12,
  },
  cardText: {
    fontSize: 16,
    color: "#4b5563",
    lineHeight: 24,
    marginBottom: 16,
  },
  instructionBox: {
    backgroundColor: "#f3f4f6",
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  instructionText: {
    fontSize: 15,
    color: "#374151",
    lineHeight: 24,
  },
  button: {
    backgroundColor: "#059669",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
  outlineButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  outlineButtonText: {
    color: "#4b5563",
    fontSize: 16,
    fontWeight: "600",
  },
});
