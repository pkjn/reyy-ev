import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { Alert } from "react-native";
import { isLoggedIn, isOnboardingComplete } from "../services/auth";
import ErrorBoundary from "../src/components/ErrorBoundary";

// ErrorUtils is a React Native global — declare it for TypeScript.
declare const ErrorUtils: {
  getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

// Global JS error handler — catches errors outside the React tree
// (e.g. unhandled promise rejections, async callbacks).
// In production APKs these cause silent crashes; this shows them as alerts.
try {
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error("Global error:", error, "isFatal:", isFatal);
    try {
      Alert.alert(
        isFatal ? "Fatal Error" : "Error",
        `${error?.name}: ${error?.message}\n\n${error?.stack?.slice(0, 500)}`,
        [{ text: "OK" }]
      );
    } catch (_) {
      // Alert might not be available during early init
    }
    originalHandler(error, isFatal);
  });
} catch (_) {
  // ErrorUtils might not be available in all environments
}

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      try {
        const loggedIn = await isLoggedIn();
        const onboardingDone = await isOnboardingComplete();
        
        const inAuthGroup = segments[0] === "login";
        const inOnboarding = segments[0] === "onboarding";

        if (!loggedIn) {
          if (!inAuthGroup) {
            router.replace("/login");
          }
        } else if (!onboardingDone) {
          if (!inOnboarding) {
            router.replace("/onboarding");
          }
        } else {
          if (inAuthGroup || inOnboarding) {
            router.replace("/home");
          }
        }
      } catch (err) {
        console.error("checkAuth error:", err);
        Alert.alert("Auth Error", String(err));
      }
      setIsReady(true);
    }
    checkAuth();
  }, [segments]);

  if (!isReady) return null;

  return (
    <ErrorBoundary>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="home" />
      </Stack>
    </ErrorBoundary>
  );
}

