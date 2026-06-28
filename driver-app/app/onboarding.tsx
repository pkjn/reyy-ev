import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, PermissionsAndroid } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { setOnboardingComplete } from "../services/auth";

export default function OnboardingScreen() {
  const router = useRouter();

  const handlePermissionsAndContinue = async () => {
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
    if (Platform.OS === "android" && Platform.Version >= 33) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        alert("Notification permission is required for background tracking.");
        return;
      }
    }

    // Mark setup as complete and proceed
    await setOnboardingComplete();
    router.replace("/home");
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome to Reyy EV</Text>
        <Text style={styles.subtitle}>Let's get you set up</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Background Tracking Setup</Text>
          
          <Text style={styles.cardText}>
            Reyy EV collects location data to enable live fleet tracking and route monitoring even when the app is closed or not in use.
          </Text>
          
          <Text style={styles.cardText}>
            To ensure accurate mileage and active tracking while you are on duty, please grant <Text style={{fontWeight: "bold"}}>Always Allow</Text> location access and enable notifications when prompted.
          </Text>

          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>
              Note for Xiaomi/Vivo/Oppo devices: Please ensure this app is excluded from battery optimization in your phone settings to prevent tracking dropouts.
            </Text>
          </View>

          <TouchableOpacity style={styles.button} onPress={handlePermissionsAndContinue}>
            <Text style={styles.buttonText}>Grant Access & Continue</Text>
          </TouchableOpacity>
        </View>
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
    borderLeftWidth: 4,
    borderLeftColor: "#059669",
  },
  instructionText: {
    fontSize: 14,
    color: "#4b5563",
    lineHeight: 22,
    fontStyle: "italic",
  },
  button: {
    backgroundColor: "#059669",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
