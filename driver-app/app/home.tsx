import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, ActivityIndicator, AppState, AppStateStatus, TouchableOpacity, Text } from "react-native";
import { WebView } from "react-native-webview";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { getToken, clearToken } from "../services/auth";
import { API_BASE_URL } from "../config/env";
import { startLocationUpdates } from "../services/location";
import { useLanguage } from "../src/context/LanguageContext";
import { t } from "../src/utils/i18n";

export default function HomeScreen() {
  const [token, setToken] = useState<string | null>(null);
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);
  const appState = useRef(AppState.currentState);

  const { language, setLanguage, isLoading } = useLanguage();

  useEffect(() => {
    async function load() {
      const t = await getToken();
      if (!t) {
        router.replace("/login");
      } else {
        setToken(t);
        // Start background location service when we enter home screen
        await startLocationUpdates();
      }
    }
    load();

    const subscription = AppState.addEventListener("change", (nextAppState: AppStateStatus) => {
      // Force an immediate location push when app comes to foreground
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        // We will implement forceLocationPush inside services/location.ts
        // forceLocationPush(); 
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  if (isLoading || !token) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#059669" />
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
          // Handle tel: and mailto: links natively rather than inside WebView
          if (request.url.startsWith("tel:") || request.url.startsWith("mailto:")) {
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
});
