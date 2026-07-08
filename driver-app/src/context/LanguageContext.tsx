import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { LanguageCode } from '../utils/i18n';

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  isLoading: true,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>('en');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadLang() {
      try {
        const stored = await SecureStore.getItemAsync('reyy_driver_lang');
        if (stored === 'en' || stored === 'hi') {
          setLanguageState(stored);
        }
      } catch (err) {
        console.error('Failed to load language preference', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadLang();
  }, []);

  const setLanguage = async (lang: LanguageCode) => {
    setLanguageState(lang);
    try {
      await SecureStore.setItemAsync('reyy_driver_lang', lang);
    } catch (err) {
      console.error('Failed to save language preference', err);
    }
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, isLoading }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
