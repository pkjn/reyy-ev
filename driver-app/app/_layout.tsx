import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { isLoggedIn, isOnboardingComplete } from "../services/auth";

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
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
      setIsReady(true);
    }
    checkAuth();
  }, [segments]);

  if (!isReady) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="home" />
    </Stack>
  );
}
