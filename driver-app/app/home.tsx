import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, ActivityIndicator, AppState, AppStateStatus } from "react-native";
import { WebView } from "react-native-webview";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { getToken, clearToken } from "../services/auth";
import { API_BASE_URL } from "../config/env";
import { startLocationUpdates } from "../services/location";

export default function HomeScreen() {
  const [token, setToken] = useState<string | null>(null);
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);
  const appState = useRef(AppState.currentState);

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

  if (!token) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  // The WebView hits /driver/auth?token=<JWT>.
  // The server sets the cookie and redirects to /driver.
  const uri = `${API_BASE_URL}/driver/auth?token=${token}`;

  return (
    <View style={styles.container}>
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
});
