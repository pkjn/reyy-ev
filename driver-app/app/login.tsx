import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image } from "react-native";
import { useRouter } from "expo-router";
import { login } from "../services/api";
import { saveToken } from "../services/auth";

export default function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async () => {
    if (!phone || !password) {
      Alert.alert("Error", "Please enter phone and password");
      return;
    }

    setLoading(true);
    try {
      const data = await login(phone, password);

      // Save token — wrapped separately because expo-secure-store can throw
      // native exceptions in APK builds if the keychain isn't ready.
      try {
        await saveToken(data.token);
      } catch (storeErr) {
        console.error("Failed to save token to SecureStore:", storeErr);
        Alert.alert(
          "Storage Error",
          "Could not save login credentials. Please try again."
        );
        return;
      }

      // Don't call router.replace() here — _layout.tsx watches `segments`
      // and will automatically route to /onboarding or /home once it detects
      // the token via isLoggedIn(). Calling replace from both login.tsx AND
      // _layout.tsx simultaneously causes a race-condition crash on Android.
      router.replace("/onboarding");
    } catch (err) {
      console.error("Login error:", err);
      Alert.alert("Login Failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image 
          source={require("../assets/images/reyy-ev-logo.jpeg")} 
          style={styles.logo} 
          resizeMode="contain" 
        />
        <Text style={styles.title}>Reyy EV</Text>
        <Text style={styles.subtitle}>Driver App</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Phone Number (10 digits)"
          placeholderTextColor="#9ca3af"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
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
            <Text style={styles.buttonText}>Login</Text>
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
