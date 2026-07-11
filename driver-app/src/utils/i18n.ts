export const translations = {
  en: {
    loginErrorTitle: "Error",
    loginErrorMissing: "Please enter phone and password",
    loginStorageError: "Storage Error",
    loginStorageDesc: "Could not save login credentials. Please try again.",
    loginFailed: "Login Failed",
    driverApp: "Driver App",
    phonePlaceholder: "Phone Number (10 digits)",
    passwordPlaceholder: "Password",
    loginBtn: "Login",
    welcomeTitle: "Welcome to Reyy EV",
    welcomeDesc: "Let's get you set up",
    obTitle: "Application Setup",
    obDesc1: "For the application to work correctly, we need some permissions.",
    obDesc2: "Please allow the requested permissions when prompted, otherwise the application will not function properly.",
    obNote: "Note for Xiaomi/Vivo/Oppo devices: Please ensure this app is excluded from battery optimization in your phone settings to prevent app dropouts.",
    grantAccess: "Grant Access & Continue",
    fgError: "Permission is required to continue.",
    bgError: "Background permissions are required.",
    notifError: "Notification permission is required.",
    toggleLang: "हिंदी",
    switchLang: "hi"
  },
  hi: {
    loginErrorTitle: "त्रुटि",
    loginErrorMissing: "कृपया फोन नंबर और पासवर्ड दर्ज करें",
    loginStorageError: "स्टोरेज त्रुटि",
    loginStorageDesc: "लॉगिन जानकारी सेव नहीं की जा सकी। कृपया पुनः प्रयास करें।",
    loginFailed: "लॉगिन विफल",
    driverApp: "ड्राइवर ऐप",
    phonePlaceholder: "फोन नंबर (10 अंक)",
    passwordPlaceholder: "पासवर्ड",
    loginBtn: "लॉगिन करें",
    welcomeTitle: "Reyy EV में आपका स्वागत है",
    welcomeDesc: "आइए आपका सेटअप करें",
    obTitle: "ऐप सेटअप",
    obDesc1: "एप्लिकेशन को सही ढंग से काम करने के लिए, हमें कुछ अनुमतियों (permissions) की आवश्यकता है।",
    obDesc2: "कृपया पूछे जाने पर आवश्यक अनुमतियां दें, अन्यथा एप्लिकेशन ठीक से काम नहीं करेगा।",
    obNote: "Xiaomi/Vivo/Oppo डिवाइस के लिए नोट: कृपया सुनिश्चित करें कि इस ऐप को आपके फ़ोन की सेटिंग में बैटरी ऑप्टिमाइज़ेशन से बाहर रखा गया है ताकि ऐप ठीक से चलता रहे।",
    grantAccess: "अनुमति दें और आगे बढ़ें",
    fgError: "आगे बढ़ने के लिए अनुमति आवश्यक है।",
    bgError: "बैकग्राउंड अनुमतियों की आवश्यकता है।",
    notifError: "नोटिफिकेशन अनुमति आवश्यक है।",
    toggleLang: "English",
    switchLang: "en"
  }
};

export type LanguageCode = keyof typeof translations;

export function t(lang: LanguageCode, key: keyof typeof translations['en']): string {
  return translations[lang]?.[key] || translations['en'][key] || key;
}
