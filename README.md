<p align="center">
  <img src="icon-192.png" width="120" alt="PDF Kalemi simgesi">
</p>

<h1 align="center">PDF Kalemi</h1>

<p align="center">
  <b>Surface Pro için kalemle kontrol edilen, yapay zekâ destekli PDF görüntüleyici ve sunum aracı</b><br>
  <sub>A pen-first, AI-assisted PDF viewer and presentation tool for Surface Pro — also on Windows x64, Android and the web.</sub>
</p>

<p align="center">
  <img alt="Windows ARM64 ve x64" src="https://img.shields.io/badge/Windows-ARM64%20%7C%20x64-0078D4?logo=windows&logoColor=white">
  <img alt="Android" src="https://img.shields.io/badge/Android-7%2B-3DDC84?logo=android&logoColor=white">
  <img alt="Web / PWA" src="https://img.shields.io/badge/Web-PWA-5A0FC8?logo=pwa&logoColor=white">
  <img alt="Lisans MIT" src="https://img.shields.io/badge/lisans-MIT-blue">
</p>

<p align="center">
  <a href="https://ufukasia.github.io/pdf-kalemi/"><b>🌐 Tarayıcıda dene</b></a> ·
  <a href="#kurulum">Kurulum</a> ·
  <a href="#surface-proda-kalemle-kullanım">Kalemle kullanım</a> ·
  <a href="#yapay-zekâ">Yapay zekâ</a> ·
  <a href="#gizlilik-ve-api-anahtarları">Gizlilik</a>
</p>

---

PDF Kalemi, ders slaytlarını ve PDF belgelerini **Surface Pen ile kâğıda yazar gibi** işaretlemek, sınıfta **slayt slayt sunmak** ve ekrandaki sayfayı **yapay zekâya sormak** için yapıldı. Her şey kalemle yapılabilir: yazmak, silmek, seçip taşımak, döndürmek, sayfa çevirmek ve menüleri açmak. Klavye ya da fare gerekmez.

- ✒️ **Gerçek mürekkep hissi.** Çizgi baskıya, hıza ve yöne göre incelip kalınlaşır; dolma kalem, fırça ve kaligrafi uçları vardır.
- 🖊️ **Kalemin her tuşu iş görür.** Arka uç silgidir. Yan tuşa basılı tutarak çizdiğiniz alan seçilir; seçilenler sürüklenir, döndürülür, büyütülüp küçültülür.
- 🖥️ **Sunuma hazır.** Tam ekran slayt kipi, parmakla dokunarak ya da sunum kumandasıyla ileri/geri, dikkat çeken neon lazer kalemi.
- 🤖 **Yapay zekâ destekli.** Sayfayı sesle sorun, cevabı doğal Türkçe sesle dinleyin. Ya da sayfayı tek dokunuşla Claude, ChatGPT, Gemini veya Codex'e aktarın; görüntü sohbete kendiliğinden yapıştırılır.
- 📂 **Ders klasörleriniz elinizin altında.** Klasörlerinizi ekleyip istediğiniz adı verin (ör. *Mat1*); OneDrive klasörleri de olur.
- 🔒 **Gizliliğe saygılı.** PDF'leriniz ve notlarınız cihazınızda kalır; siz "Gönder"e basmadıkça hiçbir şey dışarı gitmez.

## Surface Pro'da kalemle kullanım

| Kalemle / parmakla | Ne olur |
|---|---|
| Uçla yaz | Baskıya duyarlı mürekkep (uç tipi ve renk üst araç çubuğundan) |
| Kalemi çevirip arka uçla sil | Silgi; araç değiştirmeye gerek yok |
| **Yan tuş basılıyken** çevresine çiz | Yazılanları seçer |
| Seçimin içinden sürükle | Taşır |
| Seçimin **sağ üst** köşesi | Döndürür (90°'nin katlarına yapışır) |
| Seçimin **diğer köşeleri** | Büyütür / küçültür (çizgi kalınlığı da orantılı) |
| Seçimin dışına dokun (kalem ya da parmak) | Seçimi bırakır, iz bırakmaz |
| Parmakla **tek dokunuş / çift dokunuş** | Sonraki / önceki slayt |
| Kenarlardaki **oklu küçük diller** | Menüleri açar (üst: araçlar, sol: klasörler, sağ: sayfalar, alt: ayarlar) |
| Sürüklenebilir **balonlar** | Yapay zekâ asistanı ve "yapay zekâya aktar" |

"Parmakla çiz" kapalıyken parmak yalnızca kaydırır ve yakınlaştırır; yalnız kalem yazar ve avuç içi ekrana değse bile iz kalmaz. Kenar dilleri ekranın en kenarına yapışık değildir; bu yüzden Windows'un kenardan kaydırma hareketleri ve telefonun sistem çubukları tetiklenmez.

## Özellikler

### ✒️ Kalem ve mürekkep
- **Baskıya duyarlı, uçları sivrilen mürekkep.** Çizgiler pürüzsüz eğrilerle çizilir.
- **Uç tipleri:** tükenmez, dolma kalem, fırça ve kaligrafi (yatık uç). Baskı hassasiyeti ayarlanabilir.
- Fosforlu kalem, düz çizgi, ok, dikdörtgen, elips ve silgi.
- **Gökkuşağı rengi:** renkleri sayfa üzerinde sürekli akan, hareketli kalem rengi (kalem, fosforlu kalem ve şekiller için). PDF'e renk renk kaydedilir.
- **Neon lazer kalemi:** sunumda parlayıp birkaç saniyede kaybolan iz.
- **Düşük gecikme:** `pointerrawupdate` ve senkronsuz çizim yüzeyleri sayesinde mürekkep kalemin ucundan geri kalmaz.
- Kalemin yan tuşu Ayarlar'dan silgi olarak da kullanılabilir. Bütün işlemler geri alınabilir.

### 🖥️ Sunum
- Sayfa ekrana sığınca **slayt slayt sunum kipi** devreye girer; slaytlar arasında siyah boşluk kalmaz.
- **İleri/geri:** parmakla tek/çift dokunuş, klavye oklarıyla, sunum kumandasıyla (PageUp/PageDown) ya da fare tekerleğiyle. Sayfa büyütülmüşse ilk basış önce sayfayı tam genişliğe getirir.
- PDF içindeki **bağlantılar ve içindekiler** doğru sayfaya götürür; `Alt+←` ile geri dönülür.
- Sağdaki **film şeridi** bütün sunumu küçük resimlerle gösterir.

### ⭐ Kuzey Yıldızı kartı
- Derste öğrencilerin aklında kalması gereken formül ya da not için, **sayfalardan bağımsız, ekranda sabit duran** bir kart. Slayt değişse, sayfa yakınlaştırılsa da yerinde kalır.
- Üst ortasında sarı, çevresi gökkuşağı renkli bir yıldız vardır. Üzerine kalemle yazılır (gökkuşağı rengi dahil), kalemin arka ucuyla silinir.
- **Yıldıza dokununca notlar kapanır, yıldız ekranda kalır**; sunum alanı tamamen açılır. Tekrar dokununca notlar geri gelir. Yıldız sürüklenerek taşınır.
- Sağ alt köşesinden büyütülüp küçültülür; **yazının boyu değişmez**, slayta yazılanla aynı büyüklükte görünür (kart büyüyünce yalnızca yazacak yer açılır). Parmakla ya da üst şeridinden tutularak taşınır.
- Araç çubuğundaki ⭐ düğmesi, `N` kısayolu ya da Ayarlar → Sunum ile açılıp kapanır. İçeriği her PDF için ayrı saklanır.

### 🗂️ Dosyalar ve klasörler
- Sol menüde iki sekme: **Klasörlerim** ve **Son açılanlar**. Klasörlere istediğiniz adı verebilirsiniz; içlerindeki PDF'ler alt klasörlerle birlikte listelenir ve aranabilir.
- **OneDrive (okul hesabı):** Klasörlerim → **+ OneDrive** ile Microsoft hesabınızla giriş yapıp OneDrive'ınızdaki ya da sizinle paylaşılan klasörleri ekleyin; Android'de ve web'de de çalışır. Dosyalar yalnızca okunur; açılan sunumların kopyası cihazda saklanır, internet yokken de açılır. Kurumun Microsoft Entra'sında bir uygulama kaydı gerekir (Ayarlar → OneDrive → Uygulama kaydı).
- Her PDF kaldığınız sayfadan açılır. Mürekkep her dosya için otomatik saklanır.
- **PDF olarak kaydetme** vektöreldir: yazılar büyütüldüğünde bulanıklaşmaz.
- Windows'ta PDF Kalemi **varsayılan PDF uygulaması** olabilir. Android'de dosya yöneticisinde "PDF Kalemi ile aç" seçeneği çıkar.

### 🗂️ Çekmeceler
Kenarlardaki oklu dillere dokunarak ya da onları sürükleyerek açılırlar:

| Kenar | İçerik |
|---|---|
| ⬇️ Üst | Araç çubuğu (tek satır). 📌 ile açık sabitlenebilir. |
| ➡️ Sol | Klasörlerim ve Son açılanlar |
| ⬅️ Sağ | Sayfaların küçük resimleri (film şeridi) |
| ⬆️ Alt | **Ayarlar:** parmak, sunum, kalem, yapay zekâ, ses, sistem, görünüm |

## Yapay zekâ

### 🤖 Sesli asistan
- Ekranda gezdirilebilen bir **balon**: basın ve o anki slayt hakkında sorunuzu sesle sorun (ya da yazın).
- Sayfanın görüntüsü ve sorunuz **OpenRouter** üzerindeki **ücretsiz** görüntü anlayan modellere gider. Bir model meşgulse sıradakine geçilir.
- **Hiçbir şey siz "Gönder"e basmadan gitmez.** Önce ne gönderileceğini görürsünüz; sesi yeniden kaydedebilir ya da iptal edebilirsiniz.
- Cevap doğal Türkçe sesle okunur.

### ✳️ Yapay zekâya aktar (API anahtarı gerekmez)
- İkinci balon sayfayı ya da kalemle seçtiğiniz alanı **Claude, ChatGPT, Gemini, Antigravity veya Codex**'e aktarır. Hangisinin kullanılacağı Ayarlar'dan seçilir; balon o yapay zekânın renginde olur ve altında adı yazar.
- Uygulaması kuruluysa uygulama, değilse sitesi açılır. Claude uygulaması doğrudan yeni bir sohbetle açılır.
- **Masaüstünde görüntü sohbetin yazma kutusuna kendiliğinden yapıştırılır.** Klavyesiz tablette de çalışır. Sorunuzu yazar ya da sesli modda söylersiniz; **Gönder'e her zaman siz basarsınız.** Kendi aboneliğinizle, o yapay zekânın kendi penceresinde çalışır.
- Android'de ve tabletlerde paylaş menüsü açılır; seçtiğiniz uygulamaya görüntü ekli gider.

### 🔊 Ses servisleri
Ayarlar → Ses bölümünden seçilir; her servisin yanında "API anahtarı nedir, nasıl alınır?" açıklaması vardır.

| Servis | Konuşmayı anlama | Seslendirme | Ücret |
|---|---|---|---|
| **Azure Speech** (varsayılan) | ✅ | ✅ Doğal Türkçe sesler (Emel, Ahmet…) | Ücretsiz katman: aylık 5 saat tanıma, 0,5 milyon karakter seslendirme |
| ElevenLabs | — | ✅ En insansı ses | Sınırlı ücretsiz kullanım, sonrası ücretli |
| Yerel (yalnız Windows) | ✅ Whisper small | ✅ Piper (Türkçe) | Ücretsiz, internetsiz |
| Tarayıcı | ✅ | ✅ Sistem sesleri | Ücretsiz |

## Kısayollar

| Tuş | İşlem |
|---|---|
| `P` `H` `L` `A` `R` `O` `E` `Z` | Kalem, fosforlu, çizgi, ok, dikdörtgen, elips, silgi, lazer |
| `1` `2` `3` `4` | Uç: tükenmez, dolma kalem, fırça, kaligrafi |
| `Y` / `C` | Sesli asistan / yapay zekâya aktar |
| `T` | Üst araç çubuğunu aç/kapat |
| `N` | Kuzey Yıldızı kartını aç/kapat |
| `→` `PageDown` `Boşluk` / `←` `PageUp` | Sonraki / önceki sayfa |
| `Home` / `End` / `G` | İlk sayfa / son sayfa / sayfaya git |
| `Alt+←` / `Alt+→` | Bağlantıdan geri / ileri |
| `+` / `-` / `0` | Yakınlaştır / uzaklaştır / genişliğe sığdır |
| `Ctrl+Z` / `Ctrl+Y` | Geri al / ileri al |
| `Ctrl+S` / `Ctrl+O` | PDF olarak kaydet / dosya aç |
| `Delete` / `Esc` | Seçimi sil / seçimi bırak |

## Kurulum

| Cihaz | Dosya | Not |
|---|---|---|
| **Surface Pro 11** ve diğer ARM bilgisayarlar | `PDF-Kalemi-Kurulum-arm64.exe` | Snapdragon işlemciler için yerel sürüm |
| Intel / AMD Windows bilgisayarlar | `PDF-Kalemi-Kurulum-x64.exe` | Kalemsiz bilgisayarlarda fare ve parmakla da çalışır |
| Kurulumsuz (taşınabilir) | `PDF-Kalemi-arm64.exe`, `PDF-Kalemi-x64.exe` | USB bellekten çalışır |
| Android telefon ve tablet | `PDF-Kalemi-android.apk` | Android 7 ve sonrası; S Pen desteklenir |
| Her tarayıcı | https://ufukasia.github.io/pdf-kalemi/ | "Uygulamayı yükle" ile kurulabilir, internetsiz de çalışır |

**Windows:** Kurulum tek tıklıdır ve yönetici izni istemez. Ayarlar → Sistem bölümünden PDF Kalemi'ni PDF dosyaları için varsayılan uygulama yapabilirsiniz.

**Android:** APK'yi telefona aktarıp açın (OneDrive, kablo ya da e-posta ile). Android ilk seferde "bilinmeyen kaynaklardan uygulama yükleme" izni ister; bu, Play Store dışından kurulan her uygulama için istenen izindir. Uygulama internetsiz çalışır. Klasörlerim, Android'in klasör seçicisiyle çalışır ve verilen izin kalıcıdır. Kaydetme ve aktar balonu Android'in paylaş menüsünü açar.

## Geliştirme ve derleme

```bash
npm install
npm start              # Electron ile çalıştır
npm run dist:all       # Windows ARM64 + x64 ve Android APK → dist/
npm run dist:win       # yalnız Windows (ARM64 + x64)
npm run dist:android   # yalnız Android APK
```

- Derleme, Windows'un yol uzunluğu sınırına ve Gradle'ın Türkçe karakterli yollardaki sorunlarına takılmamak için kısa klasörlerde yapılır (`%LOCALAPPDATA%\Temp\pkb` ve `%LOCALAPPDATA%\Temp\pka`). Çıktılar proje içindeki `dist/` klasörüne kopyalanır.
- Android için gereken Java 21 ve Android SDK yoksa ilk derlemede kendiliğinden `%LOCALAPPDATA%\pk-android` klasörüne indirilir. Android Studio gerekmez.
- **APK imza anahtarı depoda değildir.** İlk derlemede `%USERPROFILE%\.pdfkalemi` klasöründe oluşturulur. Bu klasörü yedekleyin: güncellemeler aynı anahtarla imzalanmalıdır; anahtar kaybolursa telefondaki uygulamanın silinip yeniden kurulması gerekir.
- Web sürümü için klasörü herhangi bir statik sunucuyla açmak yeterlidir (ör. `npx serve .`).

### Proje yapısı

```
index.html            Arayüz, çekmeceler, ayarlar
app.js                PDF görüntüleme, mürekkep motoru, seçim, sunum, dışa aktarma
ai.js                 Sesli yapay zekâ asistanı (balon, kayıt, onay, OpenRouter)
aktar.js              Yapay zekâya aktar balonu (Claude, ChatGPT, Gemini, Antigravity, Codex)
speech.js             Ses servisleri (Azure, ElevenLabs, tarayıcı)
web.js                Web/PWA ve Android köprüsü (IndexedDB, dosya erişimi, Capacitor)
sw.js                 Çevrimdışı önbellek
main.js / preload.js  Electron ana süreci ve güvenli köprü (otomatik yapıştırma dahil)
voice.js              Yerel Whisper ve Piper modelleri (Windows)
build/                Windows simgesi, kaynak SVG ve kurulum betiği (PDF ilişkilendirme)
lib/                  pdf.js ve pdf-lib
scripts/dist.js       Tek komutla bütün kurulum dosyaları
mobile/               Android uygulaması: Capacitor projesi, yerel eklenti, APK derleme betiği
```

## Gizlilik ve API anahtarları

- **Bu depoda hiçbir API anahtarı yoktur.** OpenRouter, Azure ve ElevenLabs anahtarlarını her kullanıcı kendisi alır ve Ayarlar'dan girer.
- Anahtarlar **yalnızca kendi cihazınızda** saklanır. Hiçbir sunucuya kaydedilmez, yalnızca ilgili servise doğrudan gönderilir.
- PDF'leriniz ve mürekkebiniz cihazınızda kalır. Bulut eşitlemesi istiyorsanız dosyalarınızı OneDrive gibi bir klasörde tutabilirsiniz.
- OneDrive bağlantısı yalnızca okuma izniyle (Files.Read.All) çalışır; oturum anahtarı yalnızca cihazınızda saklanır ve yalnızca Microsoft'a gönderilir.
- Dışarıya giden veriler yalnızca şunlardır:
  - siz **Gönder**'e bastığınızda sayfa görüntüsü ve sorunuz → OpenRouter;
  - ses tanıma ya da seslendirme için ses veya metin → seçtiğiniz servis (Azure / ElevenLabs);
  - aktar balonuyla: görüntü yalnızca panoya kopyalanır; seçtiğiniz yapay zekâya siz gönderirsiniz.
- Yerel ses kipinde hiçbir ses verisi cihazdan çıkmaz.

> Kendi çatalınızı (fork) yayımlıyorsanız anahtarlarınızı asla koda ya da `.env` dosyasına yazıp depoya göndermeyin.

## Kullanılan açık kaynaklar

- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0): PDF görüntüleme
- [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT): PDF dışa aktarma
- [Electron](https://www.electronjs.org/) (MIT) ve [electron-builder](https://www.electron.build/) (MIT): Windows uygulaması
- [Capacitor](https://capacitorjs.com/) (MIT): Android uygulaması
- [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) ve ONNX Runtime (MIT): yerel Whisper
- [Piper](https://github.com/rhasspy/piper) ve espeak-ng: yerel Türkçe seslendirme. Modeller ilk kullanımda indirilir ve kendi lisanslarına tabidir.

Claude, ChatGPT, Gemini, Antigravity, Codex, Surface ve diğer adlar sahiplerinin markalarıdır. PDF Kalemi bu şirketlerle bağlantılı değildir; yalnızca onların uygulamalarını ya da sitelerini açar.

## Lisans

MIT © Ufuk ASIL
