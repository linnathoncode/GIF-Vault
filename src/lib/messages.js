const SUPPORTED_LOCALES = Object.freeze(["en", "tr"]);
const DEFAULT_LOCALE = "en";

function normalizeLocale(rawLocale) {
  const value = String(rawLocale || "").trim().toLowerCase();
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
      languageTurkish: "Turkce",
      toggleTheme: "Toggle Theme",
    },
    popup: {
      noActiveImportToTerminate: "No active import to terminate.",
      terminateFailed: "Terminate failed.",
      importTerminationRequested: "Import termination requested.",
      pasteUrlFirst: "Paste a URL first.",
      enterValidUrl: "Please enter a valid URL.",
      startingImport: "Starting import...",
      importFailed: "Import failed",
      importButtonIdle: "Import",
      importButtonTerminate: "Terminate",
      clearVaultConfirm: "Clear all items from GIF Vault? This cannot be undone.",
      vaultCleared: "Vault cleared.",
      successImportedSingle: "Imported successfully.",
      successImportedMany: (count) => `Imported ${count} items successfully.`,
      successTweetMany: (count) => `Tweet contains ${count} media items.`,
      successConvertedMany: (count) => `${count} converted.`,
      successConvertedSingleInBatch: "1 converted.",
      successConvertedSingle: "Converted.",
      clearAllButton: "Clear all",
      importInputPlaceholder: "Paste GIF / MP4 / tweet URL",
      searchInputPlaceholder: "Search by name or source",
      tabAll: "All",
      tabFavorites: "Favorites",
      prevPage: "Prev",
      nextPage: "Next",
      previousPageAriaLabel: "Previous page",
      nextPageAriaLabel: "Next page",
      openOptions: "Open Options",
      openLogs: "Open Logs",
      themeToggleAriaLabel: "Toggle Theme",
      brandLogoAlt: "GIF Vault logo",
      pageTitle: "GIF Vault",
    },
    assist: {
      defaultReason: "Additional site access is required.",
      failedToPreparePermissionRequest: "Failed to prepare permission request.",
      missingImportUrl: "Missing import URL.",
      importButtonIdle: "Import",
      grantAndImportButton: "Grant & Import",
      accessAlreadyGranted: "Access is already granted. Start the import.",
      grantThenImport: "Grant access, then GIF Vault will import automatically.",
      waitingForPermissionGrant: "Waiting for permission grant...",
      accessNotGranted: "Access was not granted.",
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
      noSearchMatches: "No matches for your search.",
      noFavoritesYet:
        "All alone here...\nClick on the star icon to favorite your most precious GIFs.",
      emptyVaultPrompt: "Paste a URL above to import into GIF Vault.",
      emptyMascotAlt: "Empty vault placeholder mascot",
      selectionHintMany: (count) =>
        `${count} selected. Favorite/Delete act on selected cards.`,
      selectionHintSingle: "Shift+Click cards to multi-select.",
      confirmDeleteTitleMany: (count) => `Confirm delete ${count} items`,
      confirmDeleteTitleSingle: "Confirm delete",
      confirmDeleteHintMany: (count) =>
        `Click delete again to remove ${count} selected items.`,
      confirmDeleteHintSingle: "Click delete again to confirm.",
      copyFailed: "Copy failed.",
      copiedGif: "Copied GIF.",
      copiedVideoLink: "Copied video link.",
      copiedGifLink: "Copied GIF link.",
      copiedLinkTip:
        "Tip: drag and drop the GIF preview to use the GIF directly.",
      renamePrompt: "Name this GIF:",
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
      deletedMany: (count) => `${count} GIFs deleted.`,
      deletedSingle: "GIF deleted.",
      pageLabel: (currentPage, totalPages) => `Page ${currentPage} / ${totalPages}`,
      favoritesCount: (count) => `${count} favorite(s)`,
      savedAndFavoritesCount: (savedCount, favoriteCount) =>
        `${savedCount} saved | ${favoriteCount} favorite(s)`,
      selectedCount: (count) => `${count} selected`,
      sizeLabel: (size) => `Size: ${size}`,
    },
    options: {
      pageTitle: "GIF Vault Options",
      heading: "GIF Vault Options",
      subtitle: "Adjust UI and GIF conversion constants",
      warningAriaLabel: "Options warning",
      warningStrong: "Use defaults when possible.",
      warningBody:
        "Changing these settings can increase CPU usage, memory usage, and storage size. Default settings are recommended for stability and predictable performance.",
      gifConversionHeading: "GIF Conversion",
      fpsLabel: "FPS (1-30)",
      widthLabel: "Width (120-1920)",
      maxColorsLabel: "Max Colors (2-256)",
      maxDurationLabel: "Max Duration Seconds (1-60)",
      popupUiHeading: "Popup UI",
      defaultTabLabel: "Default Tab",
      defaultTabAll: "All",
      defaultTabFavorites: "Favorites",
      pageSizeLabel: "Page Size (1-60)",
      hoverPreviewEnabledLabel: "Enable Hover Preview",
      hoverPreviewDelayLabel: "Preview Delay ms (500-5000)",
      loadingOptions: "Loading options...",
      resetDefaultsButton: "Reset defaults",
      saveOptionsButton: "Save options",
      statusInvalidFields: "Please fix invalid fields.",
      statusSaved: "Options saved. Reopen popup to apply UI changes.",
      statusDefaultsRestored: "Defaults restored.",
      statusLanguageUpdated: "Language updated.",
      statusAdjustAndSave: "Adjust values and save.",
      languageLabel: "Language",
    },
    logs: {
      pageTitle: "GIF Vault Logs",
      heading: "GIF Vault Debug Logs",
      refreshButton: "Refresh",
      clearButton: "Clear",
      loadingLogs: "Loading logs...",
      loading: "Loading...",
      failedToLoad: "Failed to load logs.",
      storageCalculating: "Storage: calculating...",
      noLogsYet: "No logs yet.",
      logsMascotAlt: "Logs mascot background",
      storageEstimateApiUnavailable: "Storage: estimate API unavailable",
      storageEstimateFailed: "Storage: estimate failed",
      storageUsage: (used, total) => `Storage: ${used} used / ${total} total`,
      logCount: (count) => `${count} logs`,
      logsCleared: "Logs cleared.",
    },
    import: {
      emptyUrl: "Empty URL",
      resolvingMediaUrl: "Resolving media URL...",
      couldNotResolveMediaUrl: "Could not resolve media URL",
      couldNotResolveMediaFromPost: "Could not resolve media from that post URL.",
      fetchingMedia: (suffix = "") => `Fetching media${suffix}...`,
      importedMany: (count) => `Imported ${count} items successfully.`,
      importedSingle: "Imported successfully.",
      importTerminated: "Import terminated by user.",
      importFailed: "Import failed",
      failedToFetchMedia: "Failed to fetch media",
      checkingVideoLength: "Checking video length...",
      convertingVideoToGif: "Converting video to GIF...",
      savingToVault: "Saving to vault...",
      hostAccessRequired: "Additional site access is needed.",
      offscreenConversionFailed: "Could not convert video to GIF.",
      offscreenProbeFailed: "Could not check video length.",
      couldNotDetermineVideoDuration: "Could not determine video duration.",
      resolvedUrlNotMedia: (contentType = "") =>
        `Resolved URL is not media (${contentType || "unknown"})`,
      videoTooLong: (maxSeconds, actualSeconds) =>
        `Video too long (${maxSeconds}s/${actualSeconds.toFixed(1)}s). Change length limit in Options.`,
      importTerminatedError: "IMPORT_TERMINATED",
      missingRequestId: "Missing request ID.",
      phaseResolving: "resolving",
      phaseFetching: "fetching",
      phaseChecking: "checking",
      phaseConverting: "converting",
      phaseSaving: "saving",
      phaseComplete: "complete",
      phaseIdle: "idle",
    },
    serviceWorker: {
      contextMenuAddToVault: "Add to GIF Vault",
      resolveFailed: "Resolve failed",
      terminateFailed: "Terminate failed",
      failedToSetIcon: "Failed to set icon",
    },
    actionIcon: {
      failedToSetImageData: "Failed to set action icon via imageData",
      failedToLoadAsset: (path) => `Failed to load icon asset: ${path}`,
      failedToCreate2dContext: "Could not create 2D context for icon rendering",
    },
    offscreen: {
      probeFailed: "Probe failed",
      conversionFailed: "Conversion failed",
      inputMediaBytesEmpty: "Input media bytes are empty",
      emptyGifOutput: "FFmpeg produced empty GIF output",
      couldNotDetermineVideoDuration: "Could not determine video duration",
    },
  };
}

function createTrMessages() {
  return {
    common: {
      appName: "GIF Vault",
      languageEnglish: "Ingilizce",
      languageTurkish: "Turkce",
      toggleTheme: "Temayi Degistir",
    },
    popup: {
      noActiveImportToTerminate: "Durdurulacak etkin ice aktarma yok.",
      terminateFailed: "Durdurma basarisiz.",
      importTerminationRequested: "Ice aktarmayi durdurma istendi.",
      pasteUrlFirst: "Once bir URL yapistirin.",
      enterValidUrl: "Lutfen gecerli bir URL girin.",
      startingImport: "Ice aktarma baslatiliyor...",
      importFailed: "Ice aktarma basarisiz",
      importButtonIdle: "Ice Aktar",
      importButtonTerminate: "Durdur",
      clearVaultConfirm:
        "GIF Vault'taki tum ogeler silinsin mi? Bu islem geri alinamaz.",
      vaultCleared: "Kasa temizlendi.",
      successImportedSingle: "Basariyla ice aktarildi.",
      successImportedMany: (count) => `${count} oge basariyla ice aktarildi.`,
      successTweetMany: (count) => `Gonderi ${count} medya ogesi iceriyor.`,
      successConvertedMany: (count) => `${count} donusturuldu.`,
      successConvertedSingleInBatch: "1 oge donusturuldu.",
      successConvertedSingle: "Donusturuldu.",
      clearAllButton: "Tumunu temizle",
      importInputPlaceholder: "GIF / MP4 / tweet URL yapistirin",
      searchInputPlaceholder: "Ada veya kaynaga gore ara",
      tabAll: "Tum",
      tabFavorites: "Favoriler",
      prevPage: "Onceki",
      nextPage: "Sonraki",
      previousPageAriaLabel: "Onceki sayfa",
      nextPageAriaLabel: "Sonraki sayfa",
      openOptions: "Ayarlari Ac",
      openLogs: "Gunlukleri Ac",
      themeToggleAriaLabel: "Temayi Degistir",
      brandLogoAlt: "GIF Vault logosu",
      pageTitle: "GIF Vault",
    },
    assist: {
      defaultReason: "Ek site erisimi gerekiyor.",
      failedToPreparePermissionRequest: "Izin istegi hazirlanamadi.",
      missingImportUrl: "Ice aktarma URL'si eksik.",
      importButtonIdle: "Ice Aktar",
      grantAndImportButton: "Izin Ver ve Ice Aktar",
      accessAlreadyGranted: "Erisim zaten verildi. Ice aktarmayi baslatin.",
      grantThenImport:
        "Erisim izni verin, sonra GIF Vault otomatik olarak ice aktaracak.",
      waitingForPermissionGrant: "Izin onayi bekleniyor...",
      accessNotGranted: "Erisim izni verilmedi.",
      importingMedia: "Medya ice aktariliyor...",
      closingSuffix: "Kapatiliyor...",
      importFailedWithPeriod: "Ice aktarma basarisiz.",
      pageTitle: "Erisim Izni Ver",
      heading: "Site Erisimi Ver",
      intro:
        "Bu ice aktarma icin GIF Vault medyayi cekmeden once gecici site erisimi gerekiyor.",
      requestedHosts: "Istenen alan adlari",
      checkingAccess: "Gerekli erisim kontrol ediliyor...",
      cancelButton: "Iptal",
    },
    grid: {
      noSearchMatches: "Aramanizla eslesen oge yok.",
      noFavoritesYet:
        "Buralar biraz bos...\nEn sevdiginiz GIF'leri favorilere eklemek icin yildiza tiklayin.",
      emptyVaultPrompt: "GIF Vault'a aktarmak icin yukariya bir URL yapistirin.",
      emptyMascotAlt: "Bos kasa icin mascot gorseli",
      selectionHintMany: (count) =>
        `${count} secildi. Favori/Sil secili kartlara uygulanir.`,
      selectionHintSingle: "Coklu secim icin Shift+Tikla.",
      confirmDeleteTitleMany: (count) => `${count} ogeyi silmeyi onayla`,
      confirmDeleteTitleSingle: "Silmeyi onayla",
      confirmDeleteHintMany: (count) =>
        `${count} secili ogeyi silmek icin Sil'e tekrar tiklayin.`,
      confirmDeleteHintSingle: "Onaylamak icin Sil'e tekrar tiklayin.",
      copyFailed: "Kopyalama basarisiz.",
      copiedGif: "GIF kopyalandi.",
      copiedVideoLink: "Video baglantisi kopyalandi.",
      copiedGifLink: "GIF baglantisi kopyalandi.",
      copiedLinkTip:
        "Ipuclari: GIF'i dogrudan kullanmak icin onizlemeyi surukleyip birakin.",
      renamePrompt: "Bu GIF'e bir ad verin:",
      invalidLegacyVideo: "Eski video kaydi artik desteklenmiyor",
      invalidMediaEntry: "Gecersiz medya kaydi",
      remove: "Kaldir",
      delete: "Sil",
      savedGifAlt: "Kaydedilen GIF",
      untitled: "Adsiz",
      rename: "Yeniden adlandir",
      copy: "Kopyala",
      favorite: "Favori",
      unfavorite: "Favoriden cikar",
      favoriteBatchHint: "(toplu islem secili kartlara uygulanir)",
      deletedMany: (count) => `${count} GIF silindi.`,
      deletedSingle: "GIF silindi.",
      pageLabel: (currentPage, totalPages) => `Sayfa ${currentPage} / ${totalPages}`,
      favoritesCount: (count) => `${count} favori`,
      savedAndFavoritesCount: (savedCount, favoriteCount) =>
        `${savedCount} kayitli | ${favoriteCount} favori`,
      selectedCount: (count) => `${count} secili`,
      sizeLabel: (size) => `Boyut: ${size}`,
    },
    options: {
      pageTitle: "GIF Vault Secenekleri",
      heading: "GIF Vault Secenekleri",
      subtitle: "Arayuz ve GIF donusum ayarlarini duzenleyin",
      warningAriaLabel: "Secenek uyari alani",
      warningStrong: "Mumkunse varsayilan ayarlari kullanin.",
      warningBody:
        "Bu ayarlari degistirmek CPU kullanimini, bellek kullanimini ve depolama boyutunu artirabilir. Kararlilik ve ongorulebilir performans icin varsayilan ayarlar onerilir.",
      gifConversionHeading: "GIF Donusumu",
      fpsLabel: "FPS (1-30)",
      widthLabel: "Genislik (120-1920)",
      maxColorsLabel: "Maks Renk (2-256)",
      maxDurationLabel: "Maks Sure Saniye (1-60)",
      popupUiHeading: "Popup Arayuzu",
      defaultTabLabel: "Varsayilan Sekme",
      defaultTabAll: "Tum",
      defaultTabFavorites: "Favoriler",
      pageSizeLabel: "Sayfa Boyutu (1-60)",
      hoverPreviewEnabledLabel: "Uzerine Gelince Onizlemeyi Etkinlestir",
      hoverPreviewDelayLabel: "Onizleme Gecikmesi ms (500-5000)",
      loadingOptions: "Secenekler yukleniyor...",
      resetDefaultsButton: "Varsayilanlara don",
      saveOptionsButton: "Secenekleri kaydet",
      statusInvalidFields: "Lutfen gecersiz alanlari duzeltin.",
      statusSaved:
        "Secenekler kaydedildi. Arayuz degisiklikleri icin popup'i yeniden acin.",
      statusDefaultsRestored: "Varsayilanlar geri yuklendi.",
      statusLanguageUpdated: "Dil guncellendi.",
      statusAdjustAndSave: "Degerleri duzenleyip kaydedin.",
      languageLabel: "Dil",
    },
    logs: {
      pageTitle: "GIF Vault Gunlukleri",
      heading: "GIF Vault Hata Ayiklama Gunlukleri",
      refreshButton: "Yenile",
      clearButton: "Temizle",
      loadingLogs: "Gunlukler yukleniyor...",
      loading: "Yukleniyor...",
      failedToLoad: "Gunlukler yuklenemedi.",
      storageCalculating: "Depolama: hesaplaniyor...",
      noLogsYet: "Henuz gunluk yok.",
      logsMascotAlt: "Gunluk mascot arka plani",
      storageEstimateApiUnavailable: "Depolama: tahmin API'si kullanilamiyor",
      storageEstimateFailed: "Depolama: tahmin basarisiz",
      storageUsage: (used, total) => `Depolama: ${used} kullanildi / ${total} toplam`,
      logCount: (count) => `${count} gunluk`,
      logsCleared: "Gunlukler temizlendi.",
    },
    import: {
      emptyUrl: "Bos URL",
      resolvingMediaUrl: "Medya URL'si cozuluyor...",
      couldNotResolveMediaUrl: "Medya URL'si cozulmedi",
      couldNotResolveMediaFromPost: "Bu gonderi URL'sinden medya cozulmedi.",
      fetchingMedia: (suffix = "") => `Medya getiriliyor${suffix}...`,
      importedMany: (count) => `${count} oge basariyla ice aktarildi.`,
      importedSingle: "Basariyla ice aktarildi.",
      importTerminated: "Ice aktarma kullanici tarafindan durduruldu.",
      importFailed: "Ice aktarma basarisiz",
      failedToFetchMedia: "Medya getirilemedi",
      checkingVideoLength: "Video suresi kontrol ediliyor...",
      convertingVideoToGif: "Video GIF'e donusturuluyor...",
      savingToVault: "Kasaya kaydediliyor...",
      hostAccessRequired: "Ek site erisimi gerekiyor.",
      offscreenConversionFailed: "Video GIF'e donusturulemedi.",
      offscreenProbeFailed: "Video suresi kontrol edilemedi.",
      couldNotDetermineVideoDuration: "Video suresi belirlenemedi.",
      resolvedUrlNotMedia: (contentType = "") =>
        `Cozulen URL medya degil (${contentType || "bilinmiyor"})`,
      videoTooLong: (maxSeconds, actualSeconds) =>
        `Video cok uzun (${maxSeconds}s/${actualSeconds.toFixed(1)}s). Uzunluk sinirini Secenekler'den degistirin.`,
      importTerminatedError: "IMPORT_TERMINATED",
      missingRequestId: "Istek kimligi eksik.",
      phaseResolving: "resolving",
      phaseFetching: "fetching",
      phaseChecking: "checking",
      phaseConverting: "converting",
      phaseSaving: "saving",
      phaseComplete: "complete",
      phaseIdle: "idle",
    },
    serviceWorker: {
      contextMenuAddToVault: "GIF Vault'a Ekle",
      resolveFailed: "Cozumleme basarisiz",
      terminateFailed: "Durdurma basarisiz",
      failedToSetIcon: "Simge ayarlanamadi",
    },
    actionIcon: {
      failedToSetImageData: "Eylem simgesi imageData ile ayarlanamadi",
      failedToLoadAsset: (path) => `Simge varligi yuklenemedi: ${path}`,
      failedToCreate2dContext:
        "Simge cizimi icin 2D baglam olusturulamadi",
    },
    offscreen: {
      probeFailed: "Sure analizi basarisiz",
      conversionFailed: "Donusum basarisiz",
      inputMediaBytesEmpty: "Girdi medya verisi bos",
      emptyGifOutput: "FFmpeg bos GIF cikisi uretti",
      couldNotDetermineVideoDuration: "Video suresi belirlenemedi",
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
  UI_MESSAGES = MESSAGE_CATALOG[activeLocale] || MESSAGE_CATALOG[DEFAULT_LOCALE];
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


