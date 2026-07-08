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
    obTitle: "Background Tracking Setup",
    obDesc1: "Reyy EV collects location data to enable live fleet tracking and route monitoring even when the app is closed or not in use.",
    obDesc2: "To ensure accurate mileage and active tracking while you are on duty, please grant Always Allow location access and enable notifications when prompted.",
    obNote: "Note for Xiaomi/Vivo/Oppo devices: Please ensure this app is excluded from battery optimization in your phone settings to prevent tracking dropouts.",
    grantAccess: "Grant Access & Continue",
    fgError: "Foreground location permission is required.",
    bgError: "Background location permission is required for live tracking.",
    notifError: "Notification permission is required for background tracking.",
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
    obTitle: "बैकग्राउंड ट्रैकिंग सेटअप",
    obDesc1: "Reyy EV लाइव फ्लीट ट्रैकिंग और रूट मॉनिटरिंग के लिए लोकेशन डेटा एकत्र करता है, भले ही ऐप बंद हो या उपयोग में न हो।",
    obDesc2: "सटीक माइलेज और सक्रिय ट्रैकिंग सुनिश्चित करने के लिए, कृपया 'हमेशा अनुमति दें' लोकेशन एक्सेस दें और संकेत मिलने पर सूचनाएं सक्षम करें।",
    obNote: "Xiaomi/Vivo/Oppo डिवाइस के लिए नोट: कृपया सुनिश्चित करें कि ट्रैकिंग ड्रॉपआउट को रोकने के लिए इस ऐप को आपके फ़ोन की सेटिंग में बैटरी ऑप्टिमाइज़ेशन से बाहर रखा गया है।",
    grantAccess: "अनुमति दें और आगे बढ़ें",
    fgError: "आगे बढ़ने के लिए लोकेशन अनुमति आवश्यक है।",
    bgError: "लाइव ट्रैकिंग के लिए बैकग्राउंड लोकेशन अनुमति आवश्यक है।",
    notifError: "बैकग्राउंड ट्रैकिंग के लिए नोटिफिकेशन अनुमति आवश्यक है।",
    toggleLang: "English",
    switchLang: "en"
  }
};

export type LanguageCode = keyof typeof translations;

export function t(lang: LanguageCode, key: keyof typeof translations['en']): string {
  return translations[lang]?.[key] || translations['en'][key] || key;
}
