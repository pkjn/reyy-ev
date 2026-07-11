import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Battery from "expo-battery";
import { pushLocation } from "./api";

const LOCATION_TASK_NAME = "background-location-task";

// Define the background task
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error(error);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (locations && locations.length > 0) {
      const loc = locations[0];
      try {
        const batteryLevel = await Battery.getBatteryLevelAsync();
        // push to server
        await pushLocation({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracy: loc.coords.accuracy || undefined,
          battery: batteryLevel > 0 ? Math.round(batteryLevel * 100) : undefined,
          captured_at: new Date(loc.timestamp).toISOString(),
        });
      } catch (err) {
        console.error("Failed to push location", err);
      }
    }
  }
});

export async function checkLocationPermissions(): Promise<boolean> {
  const { status: fgStatus } = await Location.getForegroundPermissionsAsync();
  const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
  return fgStatus === "granted" && bgStatus === "granted";
}

export async function requestLocationPermissions(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") {
    return false;
  }
  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  return bgStatus === "granted";
}

export async function startLocationUpdates() {
  const isGranted = await checkLocationPermissions();

  if (!isGranted) {
    console.warn("Location permissions not granted, cannot start updates");
    return;
  }

  // Always call startLocationUpdatesAsync to ensure the foreground service is active
  // and the latest parameters are applied, even if it was previously started.
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 60000,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: "Reyy EV",
      notificationBody: "Rental is active.",
      notificationColor: "#10B981", // emerald-500
    },
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
  });

  // Force an immediate push
  await forceLocationPush();
}

export async function stopLocationUpdates() {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

export async function forceLocationPush() {
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const batteryLevel = await Battery.getBatteryLevelAsync();
    
    await pushLocation({
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy || undefined,
      battery: batteryLevel > 0 ? Math.round(batteryLevel * 100) : undefined,
      captured_at: new Date(loc.timestamp).toISOString(),
    });
  } catch (err) {
    console.error("Force location push failed", err);
  }
}
