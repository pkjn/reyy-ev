import Constants from "expo-constants";

// The Expo app connects to the Next.js backend.
// In local dev, it connects to WSL localhost (use WSL IP, not 127.0.0.1 for physical device testing).
// In production, it connects to the Vercel domain.
export const API_BASE_URL =
  Constants.expoConfig?.extra?.API_BASE_URL || "https://reyy-ev-jet.vercel.app"; // fallback

// We can read this from app.json -> expo -> extra -> API_BASE_URL
