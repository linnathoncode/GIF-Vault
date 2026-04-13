const SUPPORTED_LOCALES = Object.freeze(["en", "tr"]);
const DEFAULT_LOCALE = "en";

function normalizeLocale(rawLocale) {
  const value = String(rawLocale || "")
    .trim()
    .toLowerCase();
  if (value === "tr" || value.startsWith("tr-")) {
    return "tr";
  }
  return "en";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function createEnMessages() {
  return {
    common: {
      appName: "GIF Vault",
      languageEnglish: "English",
      languageTurkish: "Turkish",
      toggleTheme: "Toggle theme",
    },
    popup: {
      noActiveImportToTerminate: "No import is running right now.",
      terminateFailed: "Couldn't stop the import.",
      importTerminationRequested: "Stopping import...",
      pasteUrlFirst: "Paste a URL first.",
      enterValidUrl: "Please enter a valid media or post URL.",
      startingImport: "Warming up the vault...",
      importFailed: "Import failed.",
      importButtonIdle: "Import",
      importButtonTerminate: "Stop",
      chooseFilesButton: "Choose files",
      chooseFilesFirst: "Choose one or more local files first.",
      startingFileImport: "Preparing local files...",
      importAlreadyRunning:
        "An import is already running. Wait or stop it first.",
      initializing: "Loading vault...",
      initializingDetail: "Please wait while GIF Vault finishes startup.",
      initializationFailed: "Vault is still starting. Reopen the popup.",
      clearVaultConfirm: "Clear the whole vault? This cannot be undone.",
      vaultCleared: "Vault wiped clean. Good as new!",
      successImportedSingle: "Imported successfully!",
      successImportedMany: (count) => `Imported ${count} items!`,
      successTweetMany: (count) => `This post has ${count} media items.`,
      successConvertedMany: (count) => `${count} converted to GIF.`,
      successConvertedSingleInBatch: "1 converted to GIF.",
      successConvertedSingle: "Converted to GIF.",
      clearAllButton: "Clear all",
      clearSelectionButton: "Clear",
      cancelButton: "Cancel",
      importInputPlaceholder: "Paste a GIF / MP4 / post URL",
      searchInputPlaceholder: "Search by name or source URL",
      tabAll: "All",
      tabFavorites: "Favorites",
      prevPage: "Prev",
      nextPage: "Next",
      previousPageAriaLabel: "Previous page",
      nextPageAriaLabel: "Next page",
      openOptions: "Open Options",
      openLogs: "Open Logs",
      paginationHint: "Use the arrows to move between pages.",
      themeToggleAriaLabel: "Toggle theme",
      brandLogoAlt: "GIF Vault logo",
      pageTitle: "GIF Vault",
    },
    assist: {
      defaultReason: "This import needs extra site access.",
      failedToPreparePermissionRequest:
        "Couldn't prepare the permission request.",
      missingImportUrl: "Import URL is missing.",
      importButtonIdle: "Import",
      grantAndImportButton: "Grant & Import",
      accessAlreadyGranted: "Access is already granted. Hit Import.",
      grantThenImport:
        "Grant access and GIF Vault will continue automatically.",
      waitingForPermissionGrant: "Waiting for permission grant...",
      accessNotGranted: "Access wasn't granted.",
      importingMedia: "Importing media...",
      closingSuffix: "Closing...",
      importFailedWithPeriod: "Import failed.",
      pageTitle: "Grant Access",
      heading: "Grant Site Access",
      intro:
        "This import needs temporary site access before GIF Vault can fetch the media.",
      requestedHosts: "Requested hosts",
      checkingAccess: "Checking required access...",
      cancelButton: "Cancel",
    },
    grid: {
      noSearchMatches: "No matches found.\nTry a different search term.",
      noFavoritesYet:
        "All alone here...\nMark items as Favorite from the All tab.",
      emptyVaultPrompt:
        "Your vault is empty.\nPaste a media URL above to add your first item.",
      emptyMascotAlt: "Empty vault mascot",
      selectionHintMany: (count) =>
        `${count} selected. Favorite/Delete now targets selected cards.`,
      selectionHintSingle: "Shift+Click cards for multi-select.",
      confirmDeleteTitleMany: (count) => `Confirm delete ${count} items`,
      confirmDeleteTitleSingle: "Confirm delete",
      confirmDeleteHintMany: (count) =>
        `Click delete again to remove ${count} selected items.`,
      confirmDeleteHintSingle: "Click delete again to confirm.",
      copyFailed: "Copy didn't work. Try again.",
      copiedGif: "GIF copied.",
      copiedAnimatedWebp: "Animated WebP copied.",
      copiedImage: "Image copied.",
      copiedVideoLink: "Video link copied.",
      copiedVideoLinkTip: "Tip: drag the preview to drop the GIF directly.",
      copiedGifLink: "GIF link copied.",
      copiedAnimatedWebpLink: "Animated WebP link copied.",
      copiedImageLink: "Image link copied.",
      copyNoSourceUrlForLocal: "This local item has no source URL.",
      copiedLinkTip: "Tip: drag the preview to drop it directly.",
      copiedGifLinkTip: "Tip: drag the preview to drop the GIF directly.",
      copiedImageLinkTip: "Tip: drag the preview to drop the image directly.",
      renamePrompt: "Give this GIF a name:",
      invalidLegacyVideo: "Legacy video entry is no longer supported",
      invalidMediaEntry: "Invalid media entry",
      remove: "Remove",
      delete: "Delete",
      savedGifAlt: "Saved GIF",
      untitled: "Untitled",
      rename: "Rename",
      copy: "Copy",
      favorite: "Favorite",
      unfavorite: "Unfavorite",
      favoriteBatchHint: "(batch applies to selected cards)",
      deleteBatchHint: "(batch applies to selected cards)",
      deletedMany: (count) => `${count} items deleted.`,
      deletedSingle: "Item deleted.",
      deletedGifSingle: "GIF deleted.",
      deletedAnimatedWebpSingle: "Animated WebP deleted.",
      deletedImageSingle: "Image deleted.",
      deletedVideoSingle: "Video deleted.",
      pageLabel: (currentPage, totalPages) =>
        `Page ${currentPage} / ${totalPages}`,
      favoritesCount: (count) => `${count} favorites`,
      savedAndFavoritesCount: (savedCount, favoriteCount) =>
        `${savedCount} saved | ${favoriteCount} favorites`,
      selectedCount: (count) => `${count} selected`,
      sizeLabel: (size) => `Size: ${size}`,
      sourceLocal: "local",
    },
    options: {
      pageTitle: "GIF Vault Options",
      heading: "GIF Vault Options",
      subtitle: "Tune popup behavior and GIF conversion.",
      warningAriaLabel: "Options warning",
      warningStrong: "Defaults are your friend.",
      warningBody:
        "Changing these values can increase CPU use, memory use, and storage size. Defaults are recommended for stable, predictable performance.",
      gifConversionHeading: "GIF Conversion",
      fpsLabel: "FPS (1-30)",
      widthLabel: "Width (120-1920)",
      maxColorsLabel: "Max Colors (2-256)",
      maxDownloadSizeLabel: "Max Download Size MB (5-64)",
      popupUiHeading: "Popup UI",
      defaultTabLabel: "Default Tab",
      defaultTabAll: "All",
      defaultTabFavorites: "Favorites",
      defaultTabLatest: "Latest",
      pageSizeLabel: "Page Size (1-60)",
      hoverPreviewEnabledLabel: "Enable Hover Preview",
      hoverPreviewDelayLabel: "Preview Delay ms (500-5000)",
      loadingOptions: "Loading options...",
      resetDefaultsButton: "Reset defaults",
      saveOptionsButton: "Save options",
      statusInvalidFields: "Please fix invalid fields.",
      statusSaved:
        "Options saved. Some popup changes apply when you reopen it.",
      statusDefaultsRestored: "Defaults restored.",
      statusLanguageUpdated: "Language switched.",
      statusAdjustAndSave: "Tweak values and save.",
      languageLabel: "Language",
      guideHeading: "Feedback",
      guideBodyPrimary:
        "Share feedback or suggestions to improve GIF Vault.",
      feedbackDescriptionPlaceholder:
        "Share your feedback or suggestions for improvement.",
      feedbackCharCount: (count, max) => `${count}/${max}`,
      sendFeedbackButton: "Send by email",
      feedbackDescriptionRequired:
        "Please enter feedback before sending.",
      feedbackPreparing: "Preparing feedback email...",
      feedbackFailed: "Couldn't prepare the feedback email.",
      feedbackEmailSubject: "GIF Vault Feedback",
      feedbackEmailBody: (description) =>
        `Feedback from GIF Vault user\n\nFeedback:\n${description}`,
      feedbackEmailOpened: "Feedback email draft opened.",
      guideMascotAlt: "Options guide mascot",
    },
    logs: {
      pageTitle: "GIF Vault Logs",
      heading: "GIF Vault Logs",
      refreshButton: "Refresh",
      clearButton: "Clear",
      loadingLogs: "Loading logs...",
      loading: "Loading...",
      failedToLoad: "Couldn't load logs.",
      storageCalculating: "Storage: calculating...",
      noLogsYet: "No logs yet.\nYour activity will appear here.",
      logsMascotAlt: "Logs mascot backdrop",
      storageEstimateApiUnavailable: "Storage: estimate API unavailable",
      storageEstimateFailed: "Storage: estimate failed",
      storageUsage: (used, total) => `Storage: ${used} used / ${total} total`,
      logCount: (count) => `${count} logs`,
      logCountWithTotal: (visibleCount, totalCount) =>
        `${visibleCount} logs (${totalCount} total)`,
      expandAllButton: "Expand all",
      bundleAllButton: "Bundle view",
      logsCleared: "Logs cleared.",
      reportDescriptionLabel: "What happened?",
      reportDescriptionPlaceholder:
        "Describe what you encountered, and how we can reproduce it.",
      reportBugButtonCollapsed: "Report bug",
      reportBugButtonExpanded: "Send by email",
      reportDescriptionRequired:
        "Please describe what you encountered before sending.",
      reportAttachmentHint:
        "A log file will be downloaded automatically. Attach it to the email before sending.",
      reportPreparing: "Preparing report email...",
      reportFailed: "Couldn't prepare the bug report email.",
      reportEmailSubject: "GIF Vault Bug Report",
      reportDescriptionDefault: "(No description provided)",
      reportEmailBody: (description, attachmentName, logCount) =>
        `Bug report from GIF Vault user\n\nWhat happened:\n${description}\n\nLogs attachment:\n${attachmentName} (${logCount} entries)\n\nA log file was downloaded automatically. Please attach it to this email before sending.`,
      reportEmailOpened: (attachmentName) =>
        `Email draft opened. Attach ${attachmentName} from your downloads before sending.`,
    },
    import: {
      emptyUrl: "URL is empty",
      resolvingMediaUrl: "Tracking down the media URL...",
      couldNotResolveMediaUrl: "Couldn't resolve media URL",
      couldNotResolveMediaFromPost:
        "Couldn't resolve media from that post URL.",
      fetchingMedia: (suffix = "") => `Fetching media${suffix}...`,
      readingLocalFiles: (suffix = "") => `Reading local file${suffix}...`,
      importedMany: (count) => `Imported ${count} items successfully.`,
      importedSingle: "Import complete.",
      importTerminated: "Import stopped by user.",
      concurrentImportInProgress: "Another import is already in progress.",
      mediaTooLarge: (maxMb) =>
        `Media is too large (max ${maxMb} MB). Adjust the limit in Options.`,
      importFailed: "Import failed",
      failedToFetchMedia: "Couldn't fetch media",
      checkingMediaSize: "Checking media size...",
      convertingVideoToGif: "Converting video to GIF...",
      convertingVideoToGifAttempt: "Converting video to GIF...",
      convertingVideoToGifDowngrade:
        "Output too large. Attempting again with lower quality...",
      savingToVault: "Saving to vault...",
      hostAccessRequired: "This site needs extra access first.",
      offscreenConversionFailed: "Couldn't convert video to GIF.",
      offscreenProbeFailed: "Couldn't check video duration.",
      couldNotDetermineVideoDuration: "Couldn't determine video duration.",
      resolvedUrlNotMedia: (contentType = "") =>
        `That URL does not point to media (${contentType || "unknown"})`,
      localFileNotMedia: "That file is not a supported media type.",
      importTerminatedError: "IMPORT_TERMINATED",
      missingRequestId: "Missing request ID.",
      phaseResolving: "resolving",
      phaseFetching: "fetching",
      phaseChecking: "checking",
      phaseConverting: "converting",
      phaseSaving: "saving",
      phaseComplete: "complete",
      phaseIdle: "idle",
      phaseBoot: "boot",
    },
    serviceWorker: {
      contextMenuAddToVault: "Add to GIF Vault",
      resolveFailed: "Resolve failed",
      terminateFailed: "Terminate failed",
    },
    offscreen: {
      probeFailed: "Could not check video duration.",
      conversionFailed: "Could not convert video to GIF.",
      inputMediaBytesEmpty: "Input media bytes are empty",
      emptyGifOutput: "FFmpeg produced empty GIF output",
      couldNotDetermineVideoDuration: "Couldn't determine video duration",
    },
  };
}

function createTrMessages() {
  return {
    common: {
      appName: "GIF Vault",
      languageEnglish: "İngilizce",
      languageTurkish: "Türkçe",
      toggleTheme: "Temayı değiştir",
    },
    popup: {
      noActiveImportToTerminate: "Şu anda devam eden bir aktarma yok.",
      terminateFailed: "Aktarma durdurulamadı.",
      importTerminationRequested: "Aktarma durduruluyor...",
      pasteUrlFirst: "Url yapıştırıp bir daha dene.",
      enterValidUrl: "Lütfen geçerli bir medya veya gönderi URL'si gir.",
      startingImport: "Vault hazırlanıyor...",
      importFailed: "Aktarmada bir pürüz çıktı",
      importButtonIdle: "Vault'a Aktar",
      importButtonTerminate: "Durdur",
      chooseFilesButton: "Dosya sec",
      chooseFilesFirst: "Once bir veya daha fazla yerel dosya sec.",
      startingFileImport: "Yerel dosyalar hazirlaniyor...",
      importAlreadyRunning:
        "Zaten bir aktarma sürüyor. Önce bekle ya da durdur.",
      initializing: "Vault yükleniyor...",
      initializingDetail: "GIF Vault başlatılırken lütfen bekle.",
      initializationFailed: "Vault hala başlıyor. Açılır pencereyi yeniden aç.",
      clearVaultConfirm:
        "Vault'taki her şeyi silelim mi? Bu işlem geri alınamaz.",
      vaultCleared: "Vault temizlendi. Yepyeni oldu!",
      successImportedSingle: "Başarıyla aktarıldı!",
      successImportedMany: (count) => `${count} öğe başarıyla aktarıldı!`,
      successTweetMany: (count) => `Bu gönderide ${count} medya öğesi var.`,
      successConvertedMany: (count) => `${count} öğe GIF'e dönüştürüldü.`,
      successConvertedSingleInBatch: "1 öğe GIF'e dönüştürüldü.",
      successConvertedSingle: "GIF'e dönüştürüldü.",
      clearAllButton: "Tümünü temizle",
      clearSelectionButton: "Temizle",
      cancelButton: "İptal",
      importInputPlaceholder: "GIF / MP4 / gönderi URL'si yapıştır",
      searchInputPlaceholder: "Ada veya kaynak URL'ye göre ara",
      tabAll: "Tümü",
      tabFavorites: "Favoriler",
      prevPage: "Önceki",
      nextPage: "Sonraki",
      previousPageAriaLabel: "Önceki sayfa",
      nextPageAriaLabel: "Sonraki sayfa",
      openOptions: "Ayarları Aç",
      openLogs: "Kayıtları Aç",
      paginationHint: "Sayfalar arasında gezinmek için okları kullan.",
      themeToggleAriaLabel: "Temayı değiştir",
      brandLogoAlt: "GIF Vault logosu",
      pageTitle: "GIF Vault",
    },
    assist: {
      defaultReason: "Bu aktarma için ek site erişimi gerekiyor.",
      failedToPreparePermissionRequest: "İzin isteği hazırlanamadı.",
      missingImportUrl: "Aktarılacak URL eksik.",
      importButtonIdle: "Vault'a Aktar",
      grantAndImportButton: "İzin Ver ve Aktar",
      accessAlreadyGranted: "Erişim zaten verilmiş. Aktar'a bas.",
      grantThenImport: "Erişim iznini ver, GIF Vault otomatik devam etsin.",
      waitingForPermissionGrant: "İzin onayı bekleniyor...",
      accessNotGranted: "Erişim izni verilmedi.",
      importingMedia: "Medya aktarılıyor...",
      closingSuffix: "Kapanıyor...",
      importFailedWithPeriod: "Aktarma başarısız.",
      pageTitle: "Erişim İzni",
      heading: "Site Erişimi Ver",
      intro:
        "Bu aktarma için GIF Vault'un medyayı alabilmesi adına geçici site erişimi gerekiyor.",
      requestedHosts: "İstenen alan adları",
      checkingAccess: "Gerekli erişim kontrol ediliyor...",
      cancelButton: "İptal",
    },
    grid: {
      noSearchMatches: "Eşleşme bulunamadı.\nFarklı bir arama terimi dene.",
      noFavoritesYet:
        "Kimseler yok burada...\nTümü sekmesinden öğeleri favorileyebilirsin.",
      emptyVaultPrompt:
        "Vault'un şu an boş.\nİlk öğeni eklemek için yukarıya bir medya URL'si yapıştır.",
      emptyMascotAlt: "Boş Vault maskotu",
      selectionHintMany: (count) =>
        `${count} öğe seçildi. Favori/Sil işlemleri seçili kartlara uygulanır.`,
      selectionHintSingle: "Çoklu seçim için kartlara Shift+Tıkla.",
      confirmDeleteTitleMany: (count) => `${count} öğeyi silmeyi onayla`,
      confirmDeleteTitleSingle: "Silmeyi onayla",
      confirmDeleteHintMany: (count) =>
        `${count} seçili öğeyi silmek için Sil'e tekrar tıkla.`,
      confirmDeleteHintSingle: "Onaylamak için Sil'e tekrar tıkla.",
      copyFailed: "Kopyalama olmadı, tekrar deneyelim.",
      copiedGif: "GIF kopyalandı.",
      copiedAnimatedWebp: "Animasyonlu WebP kopyalandı.",
      copiedImage: "Görsel kopyalandı.",
      copiedVideoLink: "Video bağlantısı kopyalandı.",
      copiedVideoLinkTip:
        "İpucu: GIF'i doğrudan kullanmak için önizlemeyi sürükleyip bırak.",
      copiedGifLink: "GIF bağlantısı kopyalandı.",
      copiedAnimatedWebpLink: "Animasyonlu WebP bağlantısı kopyalandı.",
      copiedImageLink: "Görsel bağlantısı kopyalandı.",
      copyNoSourceUrlForLocal: "Bu yerel öğenin kaynak URL'si yok.",
      copiedLinkTip: "İpucu: önizlemeyi sürükleyip doğrudan kullan.",
      copiedGifLinkTip:
        "İpucu: GIF'i doğrudan kullanmak için önizlemeyi sürükleyip bırak.",
      copiedImageLinkTip:
        "İpucu: görseli doğrudan kullanmak için önizlemeyi sürükleyip bırak.",
      renamePrompt: "Bu GIF'e bir ad ver:",
      invalidLegacyVideo: "Eski video kaydı artık desteklenmiyor",
      invalidMediaEntry: "Geçersiz medya kaydı",
      remove: "Kaldır",
      delete: "Sil",
      savedGifAlt: "Kaydedilen GIF",
      untitled: "Adsız",
      rename: "Yeniden adlandır",
      copy: "Kopyala",
      favorite: "Favori",
      unfavorite: "Favoriden çıkar",
      favoriteBatchHint: "(toplu işlem seçili kartlara uygulanır)",
      deleteBatchHint: "(toplu işlem seçili kartlara uygulanır)",
      deletedMany: (count) => `${count} öğe silindi.`,
      deletedSingle: "Öğe silindi.",
      deletedGifSingle: "GIF silindi.",
      deletedAnimatedWebpSingle: "Animasyonlu WebP silindi.",
      deletedImageSingle: "Görsel silindi.",
      deletedVideoSingle: "Video silindi.",
      pageLabel: (currentPage, totalPages) =>
        `Sayfa ${currentPage} / ${totalPages}`,
      favoritesCount: (count) => `${count} favori`,
      savedAndFavoritesCount: (savedCount, favoriteCount) =>
        `${savedCount} kayıtlı | ${favoriteCount} favori`,
      selectedCount: (count) => `${count} seçili`,
      sizeLabel: (size) => `Boyut: ${size}`,
      sourceLocal: "yerel",
    },
    options: {
      pageTitle: "GIF Vault Ayarları",
      heading: "GIF Vault Ayarları",
      subtitle: "Açılır pencere davranışını ve GIF dönüştürmeyi ayarla.",
      warningAriaLabel: "Ayar uyarısı",
      warningStrong: "Varsayılanlar senin dostundur.",
      warningBody:
        "Bu değerleri değiştirmek CPU kullanımını, bellek kullanımını ve depolama boyutunu artırabilir. Daha stabil ve öngörülebilir performans için varsayılan ayarlar önerilir.",
      gifConversionHeading: "GIF Dönüşümü",
      fpsLabel: "FPS (1-30)",
      widthLabel: "Genişlik (120-1920)",
      maxColorsLabel: "Maks Renk (2-256)",
      maxDownloadSizeLabel: "Maks İndirme Boyutu MB (5-64)",
      popupUiHeading: "Açılır Pencere",
      defaultTabLabel: "Varsayılan Sekme",
      defaultTabAll: "Tümü",
      defaultTabFavorites: "Favoriler",
      defaultTabLatest: "Son Kullanılan",
      pageSizeLabel: "Sayfa Boyutu (1-60)",
      hoverPreviewEnabledLabel: "Üzerine Gelince Önizlemeyi Etkinleştir",
      hoverPreviewDelayLabel: "Önizleme Gecikmesi ms (500-5000)",
      loadingOptions: "Ayarlar yükleniyor...",
      resetDefaultsButton: "Varsayılana dön",
      saveOptionsButton: "Ayarları kaydet",
      statusInvalidFields: "Lütfen geçersiz alanları düzelt.",
      statusSaved:
        "Ayarlar kaydedildi. Bazı açılır pencere değişiklikleri yeniden açınca görünür.",
      statusDefaultsRestored: "Varsayılanlar geri yüklendi.",
      statusLanguageUpdated: "Dil değiştirildi.",
      statusAdjustAndSave: "Değerleri düzenleyip kaydet.",
      languageLabel: "Dil",
      guideHeading: "Geri Bildirim",
      guideBodyPrimary:
        "GIF Vault'u geliştirmek için geri bildirim veya öneri paylaş.",
      feedbackDescriptionPlaceholder:
        "Geri bildiriminizi veya geliştirme önerilerinizi yazın.",
      feedbackCharCount: (count, max) => `${count}/${max}`,
      sendFeedbackButton: "E-posta ile gönder",
      feedbackDescriptionRequired:
        "Göndermeden önce bir geri bildirim yaz.",
      feedbackPreparing: "Geri bildirim e-postası hazırlanıyor...",
      feedbackFailed: "Geri bildirim e-postası hazırlanamadı.",
      feedbackEmailSubject: "GIF Vault Geri Bildirim",
      feedbackEmailBody: (description) =>
        `GIF Vault kullanıcı geri bildirimi\n\nGeri bildirim:\n${description}`,
      feedbackEmailOpened: "Geri bildirim e-posta taslağı açıldı.",
      guideMascotAlt: "Ayarlar rehberi maskotu",
    },
    logs: {
      pageTitle: "GIF Vault Kayıtları",
      heading: "GIF Vault Kayıtları",
      refreshButton: "Yenile",
      clearButton: "Temizle",
      loadingLogs: "Kayıtlar yükleniyor...",
      loading: "Yükleniyor...",
      failedToLoad: "Kayıtlar yüklenemedi.",
      storageCalculating: "Depolama: hesaplanıyor...",
      noLogsYet: "Henüz kayıt yok.\nEtkinliklerin burada görünecek.",
      logsMascotAlt: "Kayıtlar maskotu",
      storageEstimateApiUnavailable: "Depolama: tahmin API'si kullanılamıyor",
      storageEstimateFailed: "Depolama: tahmin başarısız",
      storageUsage: (used, total) =>
        `Depolama: ${used} kullanıldı / ${total} toplam`,
      logCount: (count) => `${count} kayıt`,
      logCountWithTotal: (visibleCount, totalCount) =>
        `${visibleCount} kayıt (${totalCount} toplam)`,
      expandAllButton: "Tümünü aç",
      bundleAllButton: "Gruplu görünüm",
      logsCleared: "Kayıtlar temizlendi.",
      reportDescriptionLabel: "Ne oldu?",
      reportDescriptionPlaceholder:
        "Karşılaştığın durumu ve nasıl yeniden oluşturabileceğimizi yaz.",
      reportBugButtonCollapsed: "Hata bildir",
      reportBugButtonExpanded: "E-posta ile gönder",
      reportDescriptionRequired: "Göndermeden önce karşılaştığın durumu yaz.",
      reportAttachmentHint:
        "Kayıt dosyası otomatik indirilecek. Göndermeden önce e-postaya ekle.",
      reportPreparing: "Hata raporu e-postası hazırlanıyor...",
      reportFailed: "Hata raporu e-postası hazırlanamadı.",
      reportEmailSubject: "GIF Vault Hata Bildirimi",
      reportDescriptionDefault: "(Açıklama girilmedi)",
      reportEmailBody: (description, attachmentName, logCount) =>
        `GIF Vault kullanıcı hata bildirimi\n\nNe oldu:\n${description}\n\nKayıt eki:\n${attachmentName} (${logCount} kayıt)\n\nKayıt dosyası otomatik indirildi. Göndermeden önce lütfen bu dosyayı e-postaya ekle.`,
      reportEmailOpened: (attachmentName) =>
        `E-posta taslağı açıldı. Göndermeden önce indirmelerden ${attachmentName} dosyasını ekle.`,
    },
    import: {
      emptyUrl: "URL boş",
      resolvingMediaUrl: "Medya URL'si bulunuyor...",
      couldNotResolveMediaUrl: "Medya URL'si çözümlenemedi",
      couldNotResolveMediaFromPost: "Bu gönderiden medya URL'si çıkarılamadı.",
      fetchingMedia: (suffix = "") => `Medya alınıyor${suffix}...`,
      readingLocalFiles: (suffix = "") => `Yerel dosya okunuyor${suffix}...`,
      importedMany: (count) => `${count} öğe başarıyla aktarıldı.`,
      importedSingle: "Aktarma tamamlandı.",
      importTerminated: "Aktarma kullanıcı tarafından durduruldu.",
      concurrentImportInProgress: "Başka bir aktarma zaten devam ediyor.",
      mediaTooLarge: (maxMb) =>
        `Medya çok büyük (maks ${maxMb} MB). Sınırı Ayarlar'dan değiştirebilirsin.`,
      importFailed: "Aktarma başarısız",
      failedToFetchMedia: "Medya alınamadı",
      checkingMediaSize: "Medya boyutu kontrol ediliyor...",
      convertingVideoToGif: "Video GIF'e dönüştürülüyor...",
      convertingVideoToGifAttempt: "Video GIF'e dönüştürülüyor...",
      convertingVideoToGifDowngrade:
        "Çıktı çok büyük. Daha düşük kalite ile tekrar deneniyor...",
      savingToVault: "Vault'a aktarılıyor...",
      hostAccessRequired: "Önce bu site için ek erişim izni gerekiyor.",
      offscreenConversionFailed: "Video GIF'e dönüştürülemedi.",
      offscreenProbeFailed: "Video süresi kontrol edilemedi.",
      couldNotDetermineVideoDuration: "Video süresi belirlenemedi.",
      resolvedUrlNotMedia: (contentType = "") =>
        `Bu URL doğrudan medya içermiyor (${contentType || "bilinmiyor"})`,
      localFileNotMedia: "Bu dosya desteklenen bir medya turu degil.",
      importTerminatedError: "IMPORT_TERMINATED",
      missingRequestId: "İstek kimliği eksik.",
      phaseResolving: "resolving",
      phaseFetching: "fetching",
      phaseChecking: "checking",
      phaseConverting: "converting",
      phaseSaving: "saving",
      phaseComplete: "complete",
      phaseIdle: "idle",
      phaseBoot: "boot",
    },
    serviceWorker: {
      contextMenuAddToVault: "GIF Vault'a Aktar",
      resolveFailed: "Çözümleme başarısız",
      terminateFailed: "Durdurma başarısız",
    },
    offscreen: {
      probeFailed: "Video süresi kontrol edilemedi.",
      conversionFailed: "Video GIF'e dönüştürülemedi.",
      inputMediaBytesEmpty: "Girdi medya verisi boş",
      emptyGifOutput: "FFmpeg boş GIF çıktısı üretti",
      couldNotDetermineVideoDuration: "Video süresi belirlenemedi",
    },
  };
}

const MESSAGE_CATALOG = deepFreeze({
  en: createEnMessages(),
  tr: createTrMessages(),
});

let activeLocale = DEFAULT_LOCALE;
let UI_MESSAGES = MESSAGE_CATALOG[activeLocale];

function setUiLocale(locale) {
  activeLocale = normalizeLocale(locale);
  UI_MESSAGES =
    MESSAGE_CATALOG[activeLocale] || MESSAGE_CATALOG[DEFAULT_LOCALE];
  return UI_MESSAGES;
}

function getUiLocale() {
  return activeLocale;
}

function getMessagesForLocale(locale) {
  const normalized = normalizeLocale(locale);
  return MESSAGE_CATALOG[normalized] || MESSAGE_CATALOG[DEFAULT_LOCALE];
}

export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  normalizeLocale,
  getMessagesForLocale,
  getUiLocale,
  setUiLocale,
  UI_MESSAGES,
};
