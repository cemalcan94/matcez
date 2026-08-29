// Supabase proje bilgilerinizi girin (Dashboard > Settings > API).
// Boş bırakılırsa uygulama DEMO modunda çalışır (veriler sadece bu tarayıcıda tutulur).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// Oyun ayarları
export const RULES = {
  budget: 100.0,
  squadSize: 15,
  maxPerTeam: 3,
  slots: { G: 2, D: 5, M: 5, F: 3 },       // 15 kişilik kadro dağılımı
  formationMin: { G: 1, D: 3, M: 2, F: 1 }, // ilk 11 asgari
  formationMax: { G: 1, D: 5, M: 5, F: 3 }, // ilk 11 azami
};

export const POS_NAMES = { G: 'Kaleci', D: 'Defans', M: 'Orta Saha', F: 'Forvet' };
export const POS_ORDER = ['G', 'D', 'M', 'F'];

// Transfer limitleri: ilk kadro serbest; sonrasında haftada freePerGw ücretsiz,
// fazlası hitCost puan ceza. Wildcard/Free Hit haftalarında ceza yok.
export const TRANSFERS = { freePerGw: 2, hitCost: 4 };

// Kozlar — sezonda her biri 1 kez, haftada en fazla 1 koz.
export const CHIPS = {
  bench_boost: {
    name: 'Yedek Gücü', short: 'YG',
    desc: 'Bu hafta yedeklerinin topladığı puanlar da toplam puanına eklenir.',
  },
  triple_captain: {
    name: 'Üçlü Kaptan', short: '3K',
    desc: 'Kaptanın bu hafta 2 yerine 3 kat puan kazanır (o oynamazsa vekil 3 kat alır).',
  },
  wildcard: {
    name: 'Joker', short: 'JK',
    desc: 'Bu hafta sınırsız ücretsiz transfer — kadronu baştan kurabilirsin, değişiklikler kalıcıdır.',
  },
  free_hit: {
    name: 'Serbest Hafta', short: 'SH',
    desc: 'Bir haftalığına sınırsız transfer — hafta bitince kadron otomatik olarak eski hâline döner.',
  },
};

// Ödüller — sponsor anlaşmaları netleşince buradan (veya ileride admin panelinden) güncellenir.
// image: ürün görseli URL'i (boş bırakılırsa ikon gösterilir).
export const PRIZES = {
  weekly: {
    enabled: true,
    eyebrow: 'Haftalık Ödül',
    title: 'Haftanın birincisi ol,\nJBL Charge 5 kazan',
    highlight: 'JBL Charge 5',   // başlıkta lime renkle vurgulanacak kısım
    sponsor: 'Ödül sponsoru yakında açıklanacak',
    // Tam banner görseli (varsa kodla çizilen banner yerine bu gösterilir):
    banner: 'assets/promo/haftalik-odul.webp',
  },
  season: {
    enabled: true,
    text: 'Sezon şampiyonuna sponsorumuzdan büyük ödül',
  },
};

// Partnerler — ana sayfanın altındaki alan. Anlaşma yapıldıkça doldurulur.
export const PARTNERS = [
  { name: 'KTFF', role: 'Ana Destekçi', placeholder: true },
  { name: 'Sponsorunuz', role: 'Haftalık Ödül Sponsoru', placeholder: true },
  { name: 'Sponsorunuz', role: 'Sezon Ödülü Sponsoru', placeholder: true },
];
