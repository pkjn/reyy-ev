import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, ActivityIndicator, AppState, AppStateStatus, TouchableOpacity, Text } from "react-native";
import { WebView } from "react-native-webview";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { getToken, clearToken } from "../services/auth";
import { API_BASE_URL } from "../config/env";
import { startLocationUpdates, checkLocationPermissions, requestLocationPermissions, forceLocationPush } from "../services/location";
import { useLanguage } from "../src/context/LanguageContext";
import { t } from "../src/utils/i18n";

export default function HomeScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);
  const appState = useRef(AppState.currentState);

  const { language, setLanguage, isLoading } = useLanguage();

  useEffect(() => {
    async function load() {
      const t = await getToken();
      if (!t) {
        router.replace("/login");
        return;
      }
      setToken(t);
      
      let granted = await checkLocationPermissions();
      if (!granted) {
        granted = await requestLocationPermissions();
      }
      
      setLocationGranted(granted);
      if (granted) {
        await startLocationUpdates();
      }
    }
    load();

    const subscription = AppState.addEventListener("change", async (nextAppState: AppStateStatus) => {
      // Force an immediate location push when app comes to foreground
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        const granted = await checkLocationPermissions();
        setLocationGranted(granted);
        if (granted) {
          await startLocationUpdates();
          await forceLocationPush();
        }
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  if (isLoading || !token || locationGranted === null) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  if (locationGranted === false) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          For the application to work correctly, we need some permissions. Please allow them, otherwise the application will not work.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={async () => {
            const granted = await requestLocationPermissions();
            setLocationGranted(granted);
            if (granted) {
              await startLocationUpdates();
            }
          }}
        >
          <Text style={styles.permissionButtonText}>Request Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.permissionButton, styles.settingsButton]}
          onPress={() => Linking.openSettings()}
        >
          <Text style={[styles.permissionButtonText, styles.settingsButtonText]}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // The WebView hits /driver/auth?token=<JWT>&lang=<lang>.
  // The server sets the cookie and redirects to /driver?lang=<lang>.
  const uri = `${API_BASE_URL}/driver/auth?token=${token}&lang=${language}`;

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'hi' : 'en');
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.langToggle} onPress={toggleLanguage}>
        <Text style={styles.langToggleText}>{t(language, "toggleLang")}</Text>
      </TouchableOpacity>

      <WebView
        ref={webViewRef}
        source={{ uri }}
        style={styles.webview}
        onMessage={async (event) => {
          if (event.nativeEvent.data === "logout") {
            await clearToken();
            // In a real implementation we would stop location updates here
            router.replace("/login");
          }
        }}
        onShouldStartLoadWithRequest={(request) => {
          // Handle external links natively rather than inside WebView
          if (request.url.startsWith("tel:") || request.url.startsWith("mailto:") || request.url.startsWith("whatsapp:")) {
            Linking.openURL(request.url).catch(() => {});
            return false;
          }
          return true;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  webview: {
    flex: 1,
    marginTop: 40, // Avoid safe area / notch (basic approach)
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  langToggle: {
    position: "absolute",
    top: 50,
    right: 24,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    zIndex: 10,
  },
  langToggleText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 14,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#ffffff",
  },
  permissionText: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 24,
    color: "#374151",
  },
  permissionButton: {
    backgroundColor: "#059669",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginBottom: 12,
    width: "100%",
    alignItems: "center",
  },
  permissionButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
  settingsButton: {
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  settingsButtonText: {
    color: "#374151",
  },
});
