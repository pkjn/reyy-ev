import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image } from "react-native";
import { useRouter } from "expo-router";
import { login } from "../services/api";
import { saveToken } from "../services/auth";
import { useLanguage } from "../src/context/LanguageContext";
import { t } from "../src/utils/i18n";

export default function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  
  const { language, setLanguage, isLoading } = useLanguage();

  if (isLoading) return null;

  const handleLogin = async () => {
    if (!phone || !password) {
      Alert.alert(t(language, "loginErrorTitle"), t(language, "loginErrorMissing"));
      return;
    }

    setLoading(true);
    try {
      const data = await login(phone, password);

      try {
        await saveToken(data.token);
      } catch (storeErr) {
        console.error("Failed to save token to SecureStore:", storeErr);
        Alert.alert(
          t(language, "loginStorageError"),
          t(language, "loginStorageDesc")
        );
        return;
      }

      router.replace("/onboarding");
    } catch (err) {
      console.error("Login error:", err);
      Alert.alert(t(language, "loginFailed"), err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
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
        <Image 
          source={require("../assets/images/reyy-ev-logo.jpeg")} 
          style={styles.logo} 
          resizeMode="contain" 
        />
        <Text style={styles.title}>Reyy EV</Text>
        <Text style={styles.subtitle}>{t(language, "driverApp")}</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder={t(language, "phonePlaceholder")}
          placeholderTextColor="#9ca3af"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder={t(language, "passwordPlaceholder")}
          placeholderTextColor="#9ca3af"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!loading}
        />

        <TouchableOpacity 
          style={[styles.button, loading && styles.buttonDisabled]} 
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>{t(language, "loginBtn")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    padding: 24,
    justifyContent: "center",
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
    alignItems: "center",
    marginBottom: 48,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 16,
    borderRadius: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#047857", // emerald-700
  },
  subtitle: {
    fontSize: 18,
    color: "#6b7280", // gray-500
    marginTop: 4,
  },
  form: {
    gap: 16,
  },
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#059669", // emerald-600
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
