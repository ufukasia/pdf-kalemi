; PDF Kalemi'yi Windows'a "PDF açabilen uygulama" olarak tanıtır.
; Böylece Ayarlar > Varsayılan uygulamalar ve "Birlikte aç" listesinde görünür.
; Windows 11 varsayılanı kullanıcının kendisinin seçmesini ister; kurulum yalnızca seçeneği hazırlar.

!macro customInstall
  ; electron-builder komutu tırnaksız yazıyor; yolda boşluk olduğu için tırnaklı haliyle yeniden yaz.
  WriteRegStr HKCU "Software\Classes\PDFKalemi.pdf\shell\open\command" "" '"$INSTDIR\PDF Kalemi.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\PDF Kalemi.exe\shell\open\command" "" '"$INSTDIR\PDF Kalemi.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "PDFKalemi.pdf" ""
  WriteRegStr HKCU "Software\Classes\Applications\PDF Kalemi.exe\SupportedTypes" ".pdf" ""
  WriteRegStr HKCU "Software\PDF Kalemi\Capabilities" "ApplicationName" "PDF Kalemi"
  WriteRegStr HKCU "Software\PDF Kalemi\Capabilities" "ApplicationDescription" "PDF uzerine kalemle yazma ve sunum"
  WriteRegStr HKCU "Software\PDF Kalemi\Capabilities\FileAssociations" ".pdf" "PDFKalemi.pdf"
  WriteRegStr HKCU "Software\RegisteredApplications" "PDF Kalemi" "Software\PDF Kalemi\Capabilities"
  ; Gezgin'e dosya ilişkilendirmelerinin değiştiğini bildir
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "PDFKalemi.pdf"
  DeleteRegKey HKCU "Software\Classes\Applications\PDF Kalemi.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "PDF Kalemi"
  DeleteRegKey HKCU "Software\PDF Kalemi"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
