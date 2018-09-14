
export class UserSettings {
  public language: string;
  public currency: string;
  public wordlistLanguage: string;
  public dphantomMode: boolean;
  public notification: boolean;

  constructor() {}

  public static defaults(lang: string): UserSettings {
    const settings = new UserSettings();
    settings.language = lang;
    settings.currency = 'usd';
    settings.wordlistLanguage = 'english';
    settings.dphantomMode = false;
    settings.notification = false;

    return settings;
  }

}
