export const ID_TYPES = [
  { value: "aadhaar", label: "Aadhaar" },
  { value: "pan", label: "PAN" },
  { value: "driving_license", label: "Driving License" },
  { value: "voter_id", label: "Voter ID" },
  { value: "passport", label: "Passport" },
  { value: "other", label: "Other" },
] as const;

export type IdType = (typeof ID_TYPES)[number]["value"];

export const ID_TYPE_LABELS: Record<IdType, string> = Object.fromEntries(
  ID_TYPES.map((t) => [t.value, t.label])
) as Record<IdType, string>;

export function isValidIdType(s: unknown): s is IdType {
  return typeof s === "string" && ID_TYPES.some((t) => t.value === s);
}

export interface CustomerId {
  id: string;
  type: IdType;
  number: string;
  originalSubmitted: boolean;
  createdAt: string;
}

// Photo categories: a profile photo, a photo of any ID type, or a free-form
// "other". Keeping these aligned with ID_TYPES lets a photo be tied back to a
// specific ID record visually (e.g. front of Aadhaar).
export const PHOTO_CATEGORIES = [
  { value: "profile", label: "Profile photo" },
  ...ID_TYPES.map((t) => ({ value: t.value, label: t.label })),
  { value: "other", label: "Other" },
] as const;

export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]["value"];

export function isValidPhotoCategory(s: unknown): s is PhotoCategory {
  return (
    typeof s === "string" && PHOTO_CATEGORIES.some((c) => c.value === s)
  );
}

export function photoCategoryLabel(c: string): string {
  const found = PHOTO_CATEGORIES.find((p) => p.value === c);
  return found ? found.label : c;
}

export interface KmsLog {
  id: string;
  rentalId: string;
  customerId: string;
  scootyLabel: string;
  kms: number;
  date: string; // YYYY-MM-DD
  note: string | null;
  createdAt: string;
}

export interface LocationLog {
  id: string;
  rentalId: string;
  latitude: number;
  longitude: number;
  batteryLevel?: number;
  timestamp: string;
  createdAt: string;
}
