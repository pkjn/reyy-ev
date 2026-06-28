import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches any unhandled JS errors in the component tree and displays them
 * on screen instead of silently crashing (which is what production APKs do).
 *
 * Wrap the root layout with this to diagnose crashes.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // This will appear in adb logcat even without the boundary UI
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>⚠️ App Error</Text>
          <Text style={styles.subtitle}>
            The app crashed. Details below:
          </Text>
          <ScrollView style={styles.scrollView}>
            <Text style={styles.errorName}>
              {this.state.error?.name}: {this.state.error?.message}
            </Text>
            <Text style={styles.errorStack}>
              {this.state.error?.stack}
            </Text>
          </ScrollView>
          <TouchableOpacity
            style={styles.button}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    padding: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#e94560",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#a0a0b0",
    marginBottom: 16,
  },
  scrollView: {
    flex: 1,
    backgroundColor: "#0f0f23",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  errorName: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#ff6b6b",
    marginBottom: 12,
  },
  errorStack: {
    fontSize: 12,
    color: "#c0c0d0",
    fontFamily: "monospace",
    lineHeight: 18,
  },
  button: {
    backgroundColor: "#059669",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
