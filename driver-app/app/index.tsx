import { Redirect } from "expo-router";

export default function Index() {
  // Layout routing logic will handle the actual redirect, this just provides
  // a valid index route so the app doesn't crash on load.
  return <Redirect href="/login" />;
}
