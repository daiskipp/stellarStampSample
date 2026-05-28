// Minimal i18n for dicekey Coffee Stamps.
// Supports Japanese (ja) and English (en).

type Locale = "ja" | "en";

const translations: Record<string, Record<Locale, string>> = {
  "app.title": { en: "dicekey Coffee", ja: "dicekey Coffee" },
  "app.subtitle": { en: "Stamps & Rewards", ja: "スタンプ & リワード" },
  "home.hello": { en: "Hello, {name}", ja: "こんにちは、{name} さん" },
  "home.summary": { en: "Your Summary", ja: "あなたのサマリー" },
  "home.visits": { en: "Visits", ja: "来店" },
  "home.beans": { en: "Beans", ja: "ビーンズ" },
  "home.benefits": { en: "Benefits", ja: "特典" },
  "home.badges": { en: "Badges", ja: "バッジ" },
  "home.nextReward": { en: "Next Reward", ja: "次の報酬" },
  "home.recentActivity": { en: "Recent Activity", ja: "最近のアクティビティ" },
  "stamps.title": { en: "Visit Stamps", ja: "来店スタンプ" },
  "stamps.total": { en: "{count} total", ja: "全 {count} 個" },
  "stamps.badges": { en: "Your Badges", ja: "あなたのバッジ" },
  "stamps.byVenue": { en: "By Venue", ja: "店舗別" },
  "stamps.history": { en: "History", ja: "履歴" },
  "rewards.title": { en: "Rewards", ja: "リワード" },
  "rewards.beans": { en: "dicekey Beans", ja: "dicekey ビーンズ" },
  "rewards.expires": { en: "Expires in {days} days", ja: "失効まで {days} 日" },
  "rewards.benefits": { en: "Benefit Vouchers", ja: "特典券" },
  "rewards.activity": { en: "Beans Activity", ja: "ビーンズ履歴" },
  "rewards.use": { en: "Use", ja: "使う" },
  "rewards.gift": { en: "Gift", ja: "贈る" },
  "settings.title": { en: "Settings", ja: "設定" },
  "settings.account": { en: "Account", ja: "アカウント" },
  "settings.network": { en: "Network", ja: "ネットワーク" },
  "settings.signout": { en: "Sign Out", ja: "ログアウト" },
  "login.signin": { en: "Sign in with Passkey", ja: "パスキーでサインイン" },
  "login.create": { en: "Create with Passkey", ja: "パスキーで新規作成" },
  "nav.home": { en: "Home", ja: "ホーム" },
  "nav.stamps": { en: "Stamps", ja: "スタンプ" },
  "nav.rewards": { en: "Rewards", ja: "リワード" },
  "nav.settings": { en: "Settings", ja: "設定" },
};

let currentLocale: Locale = "en";

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = translations[key];
  if (!entry) return key;
  let text = entry[currentLocale] ?? entry.en ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

// Auto-detect locale from browser
export function detectLocale(): Locale {
  const lang = navigator.language.slice(0, 2);
  return lang === "ja" ? "ja" : "en";
}
