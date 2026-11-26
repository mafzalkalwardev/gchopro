export type Lang = "zh" | "en";

export type TranslationRequest = {
  text: string;
  source: Lang | "auto";
  target: Lang;
};

export type TranslationResult = {
  text: string;
  detectedSource?: Lang;
  model?: string;
  characters: number;
};

export interface TranslationProvider {
  id: "deepl" | "google" | "libretranslate";
  translate(input: TranslationRequest): Promise<TranslationResult>;
  health(): Promise<boolean>;
}

export type TranslationChoice = "none" | "deepl" | "google" | "libretranslate";

export function translationApplies(input: {
  provider: TranslationChoice;
  enabled: boolean;
  userLanguage: string;
  recipientLanguage: string;
}): boolean {
  return (
    input.provider !== "none" &&
    input.enabled &&
    input.userLanguage !== input.recipientLanguage &&
    (input.userLanguage === "zh" || input.userLanguage === "en") &&
    (input.recipientLanguage === "zh" || input.recipientLanguage === "en")
  );
}

export function asLang(value: string | undefined): Lang {
  return value === "zh" ? "zh" : "en";
}
