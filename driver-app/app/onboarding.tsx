import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, PermissionsAndroid } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { setOnboardingComplete } from "../services/auth";
import { useLanguage } from "../src/context/LanguageContext";
import { t } from "../src/utils/i18n";

export default function OnboardingScreen() {
  const router = useRouter();
  const { language, setLanguage, isLoading } = useLanguage();

  if (isLoading) return null;

  const handlePermissionsAndContinue = async () => {
    // 1. Foreground Location
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== "granted") {
      alert(t(language, "fgError"));
      return;
    }
    
    // 2. Background Location
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== "granted") {
      alert(t(language, "bgError"));
      return;
    }

    // 3. Notifications (Android 13+)
    if (Platform.OS === "android" && Platform.Version >= 33) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        alert(t(language, "notifError"));
        return;
      }
    }

    // Mark setup as complete and proceed
    await setOnboardingComplete();
    router.replace("/home");
  };

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'hi' : 'en');
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.langToggle} onPress={toggleLanguage}>
        <Text style={styles.langToggleText}>{t(language, "toggleLang")}</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>{t(language, "welcomeTitle")}</Text>
        <Text style={styles.subtitle}>{t(language, "welcomeDesc")}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t(language, "obTitle")}</Text>
          
          <Text style={styles.cardText}>
            {t(language, "obDesc1")}
          </Text>
          
          <Text style={styles.cardText}>
            {t(language, "obDesc2")}
          </Text>

          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>
              {t(language, "obNote")}
            </Text>
          </View>

          <TouchableOpacity style={styles.button} onPress={handlePermissionsAndContinue}>
            <Text style={styles.buttonText}>{t(language, "grantAccess")}</Text>
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
  langToggle: {
    position: "absolute",
    top: 60,
    right: 24,
    backgroundColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    zIndex: 10,
  },
  langToggleText: {
    color: "#374151",
    fontWeight: "bold",
    fontSize: 14,
  },
  header: {
    paddingTop: 80,
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
