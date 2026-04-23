import type { ReactNode } from "react"
import { createContext, use, useCallback, useEffect, useMemo, useState } from "react"

export type SiteLocale = "en-US" | "zh-CN" | "ja-JP"
export type ThemeMode = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

const LOCALE_STORAGE_KEY = "lexio.platform-web.locale"
const THEME_STORAGE_KEY = "lexio.platform-web.theme"
const FALLBACK_LOCALE: SiteLocale = "en-US"
const LANGUAGE_CODE_SEGMENT_RE = /[-_]/u

const SITE_LOCALE_OPTIONS = [
  { value: "en-US", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "ja-JP", label: "日本語" },
] as const satisfies ReadonlyArray<{ value: SiteLocale, label: string }>

const THEME_MODE_OPTIONS = [
  { value: "system", labelKey: "system" },
  { value: "light", labelKey: "light" },
  { value: "dark", labelKey: "dark" },
] as const satisfies ReadonlyArray<{ value: ThemeMode, labelKey: "system" | "light" | "dark" }>

interface SiteCopy {
  common: {
    labels: {
      language: string
      theme: string
      languageMenu: string
      themeMenu: string
      sourceUnavailable: string
      lexioContext: string
      lexioCapture: string
      word: string
      phrase: string
    }
    navigation: {
      wordBank: string
      practice: string
    }
    actions: {
      signIn: string
      openWordBank: string
      reload: string
      backToWordBank: string
      practiceAllWords: string
      practiceAgain: string
      restart: string
      settings: string
      soundOn: string
      soundOff: string
      closeThisPage: string
      cancel: string
    }
    footer: {
      note: string
      privacy: string
      terms: string
      methodology: string
      support: string
    }
    themeMode: {
      system: string
      light: string
      dark: string
    }
  }
  home: {
    heroTitleLine1: string
    heroTitleLine2: string
    heroBodyLine1: string
    heroBodyLine2: string
    startPractice: string
    featureTitle: string
    featureBody: string
    wordBankTitle: string
    wordBankBody: string
    savedBadge: string
    tactileTitle: string
    tactileBody: string
    define: string
  }
  wordBank: {
    title: string
    subtitle: string
    searchPlaceholder: string
    sortLabel: string
    startPractice: string
    practiceNow: string
    definition: string
    inContext: string
    sourceAdded: string
    mastered: string
    pronunciationUnavailable: string
    speakWord: string
    speakSentence: string
    stopSpeaking: string
    speechLoading: string
    speechFailed: string
    statusSignedOut: string
    statusLoading: string
    statusNoMatch: string
    statusEmpty: string
    empty: {
      accountBadge: string
      accountTitle: string
      accountDescription: string
      searchBadge: string
      searchTitle: string
      searchDescription: string
      libraryBadge: string
      libraryTitle: string
      libraryDescription: string
      actionSignIn: string
    }
    missingContext: string
  }
  pricing: {
    badge: string
    title: string
    description: string
    starterBadge: string
    starterBody: string
    starterFeatures: [string, string, string]
    proBadge: string
    proBody: string
    proFeatures: [string, string, string]
    perMonth: string
    freeLabel: string
    proLabel: string
    signIn: string
    startPro: string
    openingCheckout: string
    signInToContinue: string
    missingPriceId: string
    checkoutFailed: string
  }
  checkoutSuccess: {
    badge: string
    title: string
    description: string
    authorizeExtension: string
    goToWordBank: string
  }
  extensionSync: {
    authorizeButtonSignedOut: string
    authorizeButtonIdle: string
    authorizeButtonSyncing: string
    authorizeButtonSuccess: string
    sendingSession: string
    tokenMissing: string
    syncFailed: string
    connected: string
    connectedToast: string
    successTitle: string
    successDescription: string
    successNote: string
    authorizeTitle: string
    authorizeDescription: string
    requestedAccess: string
    permissions: {
      wordBankTitle: string
      wordBankBody: string
      profileTitle: string
      profileBody: string
      sessionTitle: string
      sessionBody: string
    }
    secureNote: string
  }
  signIn: {
    title: string
    description: string
  }
  practice: {
    loadingBadge: string
    loadingTitle: string
    loadingDescription: string
    signInBadge: string
    signInTitle: string
    signInDescription: string
    errorBadge: string
    errorTitle: string
    missingItemBadge: string
    missingItemTitle: string
    missingItemDescription: string
    emptyBadge: string
    emptyTitle: string
    emptyDescription: string
    clearedBadge: string
    clearedTitle: string
    clearedDescription: string
    typingSoundTitle: string
    typingSoundDescription: string
    modeTitle: string
    modeSingleDescription: string
    modeBankDescription: string
    singleModeLabel: string
    bankModeLabel: string
    sessionCompleteBadge: string
    singleCompleteTitle: string
    bankCompleteTitle: string
    singleCompleteDescription: string
    currentWord: string
    currentPhrase: string
    accuracy: string
    speed: string
    time: string
    input: string
    correct: string
    confirmPrompt: string
    confirmMastered: string
    confirmReviewAgain: string
    decisionError: string
  }
}

const siteCopyByLocale: Record<SiteLocale, SiteCopy> = {
  "en-US": {
    common: {
      labels: {
        language: "Language",
        theme: "Theme",
        languageMenu: "Choose language",
        themeMenu: "Choose theme",
        sourceUnavailable: "Source unavailable",
        lexioContext: "Lexio Context",
        lexioCapture: "Lexio Capture",
        word: "Word",
        phrase: "Phrase",
      },
      navigation: {
        wordBank: "Word Bank",
        practice: "Practice",
      },
      actions: {
        signIn: "Sign In",
        openWordBank: "Open Word Bank",
        reload: "Reload",
        backToWordBank: "Back to Word Bank",
        practiceAllWords: "Practice All Words",
        practiceAgain: "Practice Again",
        restart: "Restart",
        settings: "Settings",
        soundOn: "On",
        soundOff: "Off",
        closeThisPage: "Close This Page",
        cancel: "Cancel",
      },
      footer: {
        note: "© 2024 LEXIO. THE INTELLECTUAL SANCTUARY FOR FOCUSED LEARNING.",
        privacy: "Privacy",
        terms: "Terms",
        methodology: "Methodology",
        support: "Support",
      },
      themeMode: {
        system: "System",
        light: "Light",
        dark: "Dark",
      },
    },
    home: {
      heroTitleLine1: "Learn Words in Context,",
      heroTitleLine2: "Then Type Them Until They Stick",
      heroBodyLine1: "Save what you meet while reading, then come back to practice it.",
      heroBodyLine2: "Move from single words into real sentences without losing focus.",
      startPractice: "Start Practice",
      featureTitle: "A System for True Mastery",
      featureBody: "Move beyond flashcards. Cultivate deep understanding through curated tools designed for focus and retention.",
      wordBankTitle: "Word Bank",
      wordBankBody: "Capture elusive words from your daily reading. Seamlessly integrate with our browser extension to save vocabulary directly from any article or paper.",
      savedBadge: "✓ Saved to Bank",
      tactileTitle: "Tactile Practice",
      tactileBody: "Engage muscle memory. Type definitions and contextual sentences in a distraction-free, fluid interface.",
      define: "Define:",
    },
    wordBank: {
      title: "Word Bank",
      subtitle: "Your curated collection of vocabulary from the web.",
      searchPlaceholder: "Search words...",
      sortLabel: "Recently Added",
      startPractice: "Start Practice",
      practiceNow: "Practice Now",
      definition: "Definition",
      inContext: "In Context",
      sourceAdded: "Source / Added",
      mastered: "Mastered",
      pronunciationUnavailable: "Pronunciation unavailable",
      speakWord: "Speak word",
      speakSentence: "Speak sentence",
      stopSpeaking: "Stop audio",
      speechLoading: "Loading audio",
      speechFailed: "Could not play audio",
      statusSignedOut: "Sign in to load your saved words.",
      statusLoading: "Loading your saved words…",
      statusNoMatch: "No words match this search.",
      statusEmpty: "No saved words yet.",
      empty: {
        accountBadge: "Lexio Account",
        accountTitle: "Sign in to open your Word Bank",
        accountDescription: "Your saved words only appear after you sign in with the same Lexio account used by the extension.",
        searchBadge: "Search",
        searchTitle: "No words match this search",
        searchDescription: "Try a shorter search term or clear the search field.",
        libraryBadge: "Word Bank",
        libraryTitle: "Your Word Bank is empty",
        libraryDescription: "Save a word from the extension first, then refresh this page to review it here.",
        actionSignIn: "Sign In",
      },
      missingContext: "No context sentence has been synced for this word yet.",
    },
    pricing: {
      badge: "Hosted Plans",
      title: "One plan keeps Lexio clear, focused, and ready across surfaces.",
      description: "Choose a simple hosted plan for synced vocabulary, web practice, and managed AI access without provider setup.",
      starterBadge: "Starter",
      starterBody: "A clean on-ramp for reading, capture, and light practice.",
      starterFeatures: ["Hosted sign-in", "Word Bank access", "Light monthly usage"],
      proBadge: "Best Value",
      proBody: "Built for daily reading, heavier practice, and stronger model routing.",
      proFeatures: ["Higher request allowance", "Stronger model routing", "Priority sync and concurrency"],
      perMonth: "/ month",
      freeLabel: "Free",
      proLabel: "Pro",
      signIn: "Sign In",
      startPro: "Start Pro",
      openingCheckout: "Opening checkout...",
      signInToContinue: "Sign in to continue",
      missingPriceId: "Missing Paddle price id",
      checkoutFailed: "Checkout failed",
    },
    checkoutSuccess: {
      badge: "Checkout Complete",
      title: "Your plan was updated.",
      description: "Lexio received the checkout result. If you installed the browser extension, open the authorization page once so the extension can refresh its access state.",
      authorizeExtension: "Authorize Extension",
      goToWordBank: "Go to Word Bank",
    },
    extensionSync: {
      authorizeButtonSignedOut: "Sign In to Continue",
      authorizeButtonIdle: "Authorize Access",
      authorizeButtonSyncing: "Authorizing...",
      authorizeButtonSuccess: "Authorized",
      sendingSession: "Sending your current Lexio session to the extension.",
      tokenMissing: "Clerk did not return a session token.",
      syncFailed: "Extension sync failed",
      connected: "Extension connected.",
      connectedToast: "Extension connected.",
      successTitle: "Extension Connected",
      successDescription: "Lexio has sent your current sign-in session to the extension. You can return to the extension now.",
      successNote: "If this tab stays open, close it manually and continue in the extension popup.",
      authorizeTitle: "Authorize Extension",
      authorizeDescription: "Allow the Lexio browser extension to use your current sign-in session and sync words into your Lexio account.",
      requestedAccess: "Requested Access",
      permissions: {
        wordBankTitle: "Save words to your Word Bank",
        wordBankBody: "The extension can add saved words and definitions to the same Lexio account you are using here.",
        profileTitle: "Basic account profile",
        profileBody: "The extension receives your display name, email address, and avatar for account identification.",
        sessionTitle: "Current sign-in session",
        sessionBody: "The extension receives a fresh Lexio session token so it can act on your behalf after you approve.",
      },
      secureNote: "Secure authorization via Lexio",
    },
    signIn: {
      title: "Sign in once. Return to your library, practice, and extension flow.",
      description: "Use your Lexio account to keep saved words, practice progress, and extension authorization in one place.",
    },
    practice: {
      loadingBadge: "Practice",
      loadingTitle: "Loading",
      loadingDescription: "Fetching your saved words and context sentences from Lexio.",
      signInBadge: "Lexio Account",
      signInTitle: "Sign in to start practice",
      signInDescription: "Your typing session uses the same remote Word Bank data that the extension syncs to Lexio.",
      errorBadge: "Practice Error",
      errorTitle: "Could not load your practice queue",
      missingItemBadge: "Single Word",
      missingItemTitle: "This word is no longer in your Word Bank",
      missingItemDescription: "Open your library, pick another word, or start a full-bank session.",
      emptyBadge: "Word Bank",
      emptyTitle: "Your Word Bank is empty",
      emptyDescription: "Save a word from the extension first, then come back here to practice it.",
      clearedBadge: "Practice Queue",
      clearedTitle: "Your queue is clear",
      clearedDescription: "Everything in your Word Bank is marked as mastered right now.",
      typingSoundTitle: "Typing sound",
      typingSoundDescription: "Play separate sounds for typing, moving to the next word, and finishing a correct answer.",
      modeTitle: "Mode",
      modeSingleDescription: "Current word only",
      modeBankDescription: "Whole Word Bank queue",
      singleModeLabel: "Single",
      bankModeLabel: "Bank",
      sessionCompleteBadge: "Session Complete",
      singleCompleteTitle: "Word finished.",
      bankCompleteTitle: "Practice complete.",
      singleCompleteDescription: "You have finished both stages for this word.",
      currentWord: "Current Word",
      currentPhrase: "Current Phrase",
      accuracy: "Accuracy",
      speed: "Speed",
      time: "Time",
      input: "Input",
      correct: "Correct",
      confirmPrompt: "Mastered this word?",
      confirmMastered: "Mastered",
      confirmReviewAgain: "Review Again",
      decisionError: "Could not save your choice. Try again.",
    },
  },
  "zh-CN": {
    common: {
      labels: {
        language: "语言",
        theme: "主题",
        languageMenu: "选择语言",
        themeMenu: "选择主题",
        sourceUnavailable: "来源不可用",
        lexioContext: "Lexio 语境",
        lexioCapture: "Lexio 收藏",
        word: "单词",
        phrase: "词组",
      },
      navigation: {
        wordBank: "单词本",
        practice: "练习",
      },
      actions: {
        signIn: "登录",
        openWordBank: "打开单词本",
        reload: "重新加载",
        backToWordBank: "回到单词本",
        practiceAllWords: "练习整本单词",
        practiceAgain: "再练一次",
        restart: "重新开始",
        settings: "设置",
        soundOn: "开",
        soundOff: "关",
        closeThisPage: "关闭此页面",
        cancel: "取消",
      },
      footer: {
        note: "© 2024 LEXIO。为专注学习而设计的语言空间。",
        privacy: "隐私",
        terms: "条款",
        methodology: "方法",
        support: "支持",
      },
      themeMode: {
        system: "跟随系统",
        light: "浅色",
        dark: "深色",
      },
    },
    home: {
      heroTitleLine1: "从真实语境记住单词",
      heroTitleLine2: "再练到自己会用",
      heroBodyLine1: "把阅读时遇到的词收进单词本。",
      heroBodyLine2: "再用单词和句子练到真正记住。",
      startPractice: "开始练习",
      featureTitle: "更接近真正掌握的一套流程",
      featureBody: "不只看卡片。把收藏、语境、打字练习放在同一条路径里，记得更久，也更自然。",
      wordBankTitle: "单词本",
      wordBankBody: "把阅读时遇到的词保存下来。配合浏览器扩展，可以从文章、论文和网页里直接收词。",
      savedBadge: "✓ 已保存到单词本",
      tactileTitle: "打字练习",
      tactileBody: "通过手部记忆练单词和句子，在干净、连贯的输入界面里把词真正打熟。",
      define: "释义：",
    },
    wordBank: {
      title: "单词本",
      subtitle: "你从网页里积累下来的词汇收藏。",
      searchPlaceholder: "搜索单词...",
      sortLabel: "最近添加",
      startPractice: "开始练习",
      practiceNow: "练这个词",
      definition: "释义",
      inContext: "语境句子",
      sourceAdded: "来源 / 添加时间",
      mastered: "已掌握",
      pronunciationUnavailable: "暂时没有发音",
      speakWord: "播放单词",
      speakSentence: "播放句子",
      stopSpeaking: "停止播放",
      speechLoading: "正在加载音频",
      speechFailed: "播放失败，请稍后重试",
      statusSignedOut: "登录后才能加载你的单词本。",
      statusLoading: "正在加载你的单词本…",
      statusNoMatch: "没有匹配这个搜索词的单词。",
      statusEmpty: "单词本里还没有内容。",
      empty: {
        accountBadge: "Lexio 账号",
        accountTitle: "登录后打开你的单词本",
        accountDescription: "只有登录和扩展里相同的 Lexio 账号后，这里的收藏词才会显示出来。",
        searchBadge: "搜索",
        searchTitle: "没有匹配的单词",
        searchDescription: "试试更短一点的关键词，或者先清空搜索框。",
        libraryBadge: "单词本",
        libraryTitle: "你的单词本还是空的",
        libraryDescription: "先在扩展里保存一个词，再回来刷新这里查看。",
        actionSignIn: "登录",
      },
      missingContext: "这个词还没有同步到语境句子。",
    },
    pricing: {
      badge: "托管方案",
      title: "一个方案就够，让 Lexio 在不同页面里都保持清爽、稳定。",
      description: "选择一个简单的托管方案，直接获得同步词库、网页练习和托管 AI 能力，不需要自己配置提供商。",
      starterBadge: "入门版",
      starterBody: "适合开始阅读、收词和轻量练习。",
      starterFeatures: ["托管登录", "单词本访问", "每月轻量使用"],
      proBadge: "更划算",
      proBody: "适合高频阅读、长期练习和更强的模型路由。",
      proFeatures: ["更高请求额度", "更强模型路由", "优先同步和并发"],
      perMonth: "/ 月",
      freeLabel: "免费",
      proLabel: "专业版",
      signIn: "登录",
      startPro: "开通专业版",
      openingCheckout: "正在打开结账页...",
      signInToContinue: "登录后继续",
      missingPriceId: "缺少 Paddle price id",
      checkoutFailed: "结账失败",
    },
    checkoutSuccess: {
      badge: "支付完成",
      title: "你的方案已经更新。",
      description: "Lexio 已经收到支付结果。如果你装了浏览器扩展，再打开一次授权页，让扩展刷新访问状态。",
      authorizeExtension: "授权扩展",
      goToWordBank: "去单词本",
    },
    extensionSync: {
      authorizeButtonSignedOut: "先登录再继续",
      authorizeButtonIdle: "授权访问",
      authorizeButtonSyncing: "授权中...",
      authorizeButtonSuccess: "已授权",
      sendingSession: "正在把你当前的 Lexio 会话发送给扩展。",
      tokenMissing: "Clerk 没有返回会话 token。",
      syncFailed: "扩展同步失败",
      connected: "扩展已连接。",
      connectedToast: "扩展已连接。",
      successTitle: "扩展已连接",
      successDescription: "Lexio 已经把你当前的登录会话发送给扩展。现在可以回到扩展继续使用了。",
      successNote: "如果这个标签页还开着，手动关掉它，然后回到扩展弹窗继续。",
      authorizeTitle: "授权扩展",
      authorizeDescription: "允许 Lexio 浏览器扩展使用你当前的登录会话，并把收藏单词同步到你的 Lexio 账号。",
      requestedAccess: "申请的权限",
      permissions: {
        wordBankTitle: "把单词保存到你的单词本",
        wordBankBody: "扩展可以把收藏单词和释义写进你当前使用的同一个 Lexio 账号。",
        profileTitle: "基础账号资料",
        profileBody: "扩展会读取你的显示名、邮箱和头像，用来识别当前账号。",
        sessionTitle: "当前登录会话",
        sessionBody: "扩展会拿到一枚新的 Lexio 会话 token，在你确认后代表你执行同步操作。",
      },
      secureNote: "通过 Lexio 进行安全授权",
    },
    signIn: {
      title: "登录一次，单词本、练习和扩展授权就能接上。",
      description: "用你的 Lexio 账号统一保存收藏单词、练习进度和扩展授权状态。",
    },
    practice: {
      loadingBadge: "练习",
      loadingTitle: "正在加载",
      loadingDescription: "正在从 Lexio 拉取你收藏的单词和语境句子。",
      signInBadge: "Lexio 账号",
      signInTitle: "登录后开始练习",
      signInDescription: "这里的打字练习会直接使用扩展同步到 Lexio 的远程单词本数据。",
      errorBadge: "练习出错",
      errorTitle: "练习队列加载失败",
      missingItemBadge: "单词单练",
      missingItemTitle: "这个词已经不在你的单词本里了",
      missingItemDescription: "回到单词本再选一个词，或者直接开始整本练习。",
      emptyBadge: "单词本",
      emptyTitle: "你的单词本还是空的",
      emptyDescription: "先在扩展里保存一个词，再回来这里开始练习。",
      clearedBadge: "练习队列",
      clearedTitle: "当前没有要练的词",
      clearedDescription: "你单词本里的词现在都已经标成已掌握了。",
      typingSoundTitle: "打字声音",
      typingSoundDescription: "打字、切到下一个词、整项输入成功时，分别给不同的轻反馈音。",
      modeTitle: "模式",
      modeSingleDescription: "只练当前这个词",
      modeBankDescription: "按整个单词本顺序练习",
      singleModeLabel: "单词",
      bankModeLabel: "整本",
      sessionCompleteBadge: "本轮完成",
      singleCompleteTitle: "这个词练完了。",
      bankCompleteTitle: "本轮练习完成。",
      singleCompleteDescription: "这个词的单词阶段和句子阶段都已经练完。",
      currentWord: "当前单词",
      currentPhrase: "当前词组",
      accuracy: "准确率",
      speed: "速度",
      time: "用时",
      input: "输入",
      correct: "正确",
      confirmPrompt: "Mastered this word?",
      confirmMastered: "Mastered",
      confirmReviewAgain: "Review Again",
      decisionError: "保存你的选择失败了，请重试。",
    },
  },
  "ja-JP": {
    common: {
      labels: {
        language: "言語",
        theme: "テーマ",
        languageMenu: "言語を選択",
        themeMenu: "テーマを選択",
        sourceUnavailable: "出典なし",
        lexioContext: "Lexio コンテキスト",
        lexioCapture: "Lexio 保存",
        word: "単語",
        phrase: "フレーズ",
      },
      navigation: {
        wordBank: "単語帳",
        practice: "練習",
      },
      actions: {
        signIn: "サインイン",
        openWordBank: "単語帳を開く",
        reload: "再読み込み",
        backToWordBank: "単語帳に戻る",
        practiceAllWords: "単語帳をまとめて練習",
        practiceAgain: "もう一度練習",
        restart: "やり直す",
        settings: "設定",
        soundOn: "オン",
        soundOff: "オフ",
        closeThisPage: "このページを閉じる",
        cancel: "キャンセル",
      },
      footer: {
        note: "© 2024 LEXIO. 集中して学ぶための静かな言語空間。",
        privacy: "プライバシー",
        terms: "利用規約",
        methodology: "方法",
        support: "サポート",
      },
      themeMode: {
        system: "システム",
        light: "ライト",
        dark: "ダーク",
      },
    },
    home: {
      heroTitleLine1: "文脈の中で覚えて、",
      heroTitleLine2: "自分で打てるまで練習する",
      heroBodyLine1: "読書中に出会った語を単語帳に入れて、あとで打って覚えます。",
      heroBodyLine2: "単語から文まで、流れを切らさずに練習できます。",
      startPractice: "練習を始める",
      featureTitle: "本当に身につけるための流れ",
      featureBody: "単語カードだけでは終わりません。保存、文脈、タイピング練習を一つの流れにまとめます。",
      wordBankTitle: "単語帳",
      wordBankBody: "読書中に出会った単語を集めて保存できます。ブラウザ拡張と組み合わせれば、記事や論文から直接追加できます。",
      savedBadge: "✓ 単語帳に保存済み",
      tactileTitle: "タイピング練習",
      tactileBody: "単語と例文を打って手で覚える。余計なものがない画面で集中して練習できます。",
      define: "定義：",
    },
    wordBank: {
      title: "単語帳",
      subtitle: "Web から集めた語彙をここで整理します。",
      searchPlaceholder: "単語を検索...",
      sortLabel: "最近追加",
      startPractice: "練習を始める",
      practiceNow: "この単語を練習",
      definition: "定義",
      inContext: "文脈",
      sourceAdded: "出典 / 追加日",
      mastered: "習得済み",
      pronunciationUnavailable: "発音はまだありません",
      speakWord: "単語を再生",
      speakSentence: "文を再生",
      stopSpeaking: "再生を停止",
      speechLoading: "音声を読み込み中",
      speechFailed: "音声を再生できませんでした",
      statusSignedOut: "単語帳を読み込むにはサインインが必要です。",
      statusLoading: "単語帳を読み込んでいます…",
      statusNoMatch: "この検索に一致する単語はありません。",
      statusEmpty: "保存された単語はまだありません。",
      empty: {
        accountBadge: "Lexio アカウント",
        accountTitle: "サインインして単語帳を開く",
        accountDescription: "拡張で使っているのと同じ Lexio アカウントでサインインすると、保存した単語がここに表示されます。",
        searchBadge: "検索",
        searchTitle: "一致する単語がありません",
        searchDescription: "検索語を短くするか、入力をクリアしてみてください。",
        libraryBadge: "単語帳",
        libraryTitle: "単語帳はまだ空です",
        libraryDescription: "まず拡張で単語を保存してから、ここを更新して確認してください。",
        actionSignIn: "サインイン",
      },
      missingContext: "この単語にはまだ文脈文が同期されていません。",
    },
    pricing: {
      badge: "ホストプラン",
      title: "Lexio をどの画面でも静かに、すぐ使える状態で保つための一つのプランです。",
      description: "語彙同期、Web 練習、管理された AI 機能を、プロバイダ設定なしでそのまま使えます。",
      starterBadge: "スターター",
      starterBody: "読み始め、単語保存、軽い練習に向いた入口プランです。",
      starterFeatures: ["ホスト型サインイン", "単語帳へのアクセス", "月ごとの軽い利用"],
      proBadge: "おすすめ",
      proBody: "毎日の読書と継続的な練習、より強いモデルルーティング向けです。",
      proFeatures: ["より高い利用枠", "強いモデルルーティング", "優先同期と同時実行"],
      perMonth: "/ 月",
      freeLabel: "無料",
      proLabel: "Pro",
      signIn: "サインイン",
      startPro: "Pro を始める",
      openingCheckout: "決済画面を開いています...",
      signInToContinue: "サインインして続行",
      missingPriceId: "Paddle price id がありません",
      checkoutFailed: "決済に失敗しました",
    },
    checkoutSuccess: {
      badge: "決済完了",
      title: "プランを更新しました。",
      description: "Lexio が決済結果を受け取りました。拡張を入れている場合は、一度認可ページを開いてアクセス状態を更新してください。",
      authorizeExtension: "拡張を認可",
      goToWordBank: "単語帳へ",
    },
    extensionSync: {
      authorizeButtonSignedOut: "サインインして続行",
      authorizeButtonIdle: "アクセスを認可",
      authorizeButtonSyncing: "認可中...",
      authorizeButtonSuccess: "認可済み",
      sendingSession: "現在の Lexio セッションを拡張へ送信しています。",
      tokenMissing: "Clerk からセッショントークンが返りませんでした。",
      syncFailed: "拡張の同期に失敗しました",
      connected: "拡張を接続しました。",
      connectedToast: "拡張を接続しました。",
      successTitle: "拡張を接続しました",
      successDescription: "Lexio は現在のサインイン状態を拡張へ送りました。拡張に戻って続けられます。",
      successNote: "このタブが残っている場合は手動で閉じ、拡張ポップアップに戻ってください。",
      authorizeTitle: "拡張を認可",
      authorizeDescription: "Lexio ブラウザ拡張が現在のサインイン状態を使い、保存単語を Lexio アカウントに同期できるようにします。",
      requestedAccess: "要求されるアクセス",
      permissions: {
        wordBankTitle: "単語帳への保存",
        wordBankBody: "拡張は、ここで使っているのと同じ Lexio アカウントに単語と定義を保存できます。",
        profileTitle: "基本プロフィール",
        profileBody: "拡張は、表示名、メールアドレス、アバターをアカウント識別のために受け取ります。",
        sessionTitle: "現在のサインイン状態",
        sessionBody: "認可後、拡張は新しい Lexio セッショントークンを受け取り、あなたの代わりに同期できます。",
      },
      secureNote: "Lexio による安全な認可",
    },
    signIn: {
      title: "一度サインインすれば、単語帳、練習、拡張認可までつながります。",
      description: "Lexio アカウントで、保存単語、練習の進み具合、拡張の認可状態を一つにまとめます。",
    },
    practice: {
      loadingBadge: "練習",
      loadingTitle: "読み込み中",
      loadingDescription: "Lexio から保存単語と文脈文を取得しています。",
      signInBadge: "Lexio アカウント",
      signInTitle: "サインインして練習を始める",
      signInDescription: "このタイピング練習は、拡張から Lexio に同期されたリモート単語帳データを使います。",
      errorBadge: "練習エラー",
      errorTitle: "練習キューを読み込めませんでした",
      missingItemBadge: "単語指定",
      missingItemTitle: "この単語はもう単語帳にありません",
      missingItemDescription: "単語帳に戻って別の単語を選ぶか、単語帳全体の練習を始めてください。",
      emptyBadge: "単語帳",
      emptyTitle: "単語帳はまだ空です",
      emptyDescription: "まず拡張で単語を保存してから、ここに戻って練習してください。",
      clearedBadge: "練習キュー",
      clearedTitle: "今は練習する単語がありません",
      clearedDescription: "単語帳の項目は現在すべて習得済みとして扱われています。",
      typingSoundTitle: "打鍵音",
      typingSoundDescription: "タイプ中、次の語への移動、正解完了で、それぞれ控えめに違う音を鳴らします。",
      modeTitle: "モード",
      modeSingleDescription: "この単語だけを練習",
      modeBankDescription: "単語帳全体を順に練習",
      singleModeLabel: "単語",
      bankModeLabel: "全体",
      sessionCompleteBadge: "完了",
      singleCompleteTitle: "この単語は終わりました。",
      bankCompleteTitle: "今回の練習が終わりました。",
      singleCompleteDescription: "この単語は、単語入力と文脈入力の両方を完了しました。",
      currentWord: "現在の単語",
      currentPhrase: "現在のフレーズ",
      accuracy: "正確さ",
      speed: "速度",
      time: "時間",
      input: "入力",
      correct: "正解",
      confirmPrompt: "Mastered this word?",
      confirmMastered: "Mastered",
      confirmReviewAgain: "Review Again",
      decisionError: "選択を保存できませんでした。もう一度試してください。",
    },
  },
}

interface SitePreferencesValue {
  locale: SiteLocale
  setLocale: (locale: SiteLocale) => void
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  resolvedTheme: ResolvedTheme
  localeOptions: typeof SITE_LOCALE_OPTIONS
  themeModeOptions: Array<{ value: ThemeMode, label: string }>
  copy: SiteCopy
  formatDate: (timestamp: number, options?: Intl.DateTimeFormatOptions) => string
  getLanguageLabel: (languageCode: string, fallback?: string) => string
}

const SitePreferencesContext = createContext<SitePreferencesValue | null>(null)

function readStoredLocale(): SiteLocale | null {
  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isSupportedLocale(storedLocale) ? storedLocale : null
  }
  catch {
    return null
  }
}

function readStoredThemeMode(): ThemeMode | null {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isSupportedThemeMode(storedTheme) ? storedTheme : null
  }
  catch {
    return null
  }
}

function isSupportedLocale(value: string | null | undefined): value is SiteLocale {
  return SITE_LOCALE_OPTIONS.some(option => option.value === value)
}

function isSupportedThemeMode(value: string | null | undefined): value is ThemeMode {
  return THEME_MODE_OPTIONS.some(option => option.value === value)
}

function normalizeLocale(locale: string | null | undefined): SiteLocale | null {
  if (!locale) {
    return null
  }

  const normalized = locale.toLocaleLowerCase()
  if (normalized.startsWith("zh")) {
    return "zh-CN"
  }

  if (normalized.startsWith("ja")) {
    return "ja-JP"
  }

  if (normalized.startsWith("en")) {
    return "en-US"
  }

  return null
}

function getInitialLocale(): SiteLocale {
  const storedLocale = readStoredLocale()
  if (storedLocale) {
    return storedLocale
  }

  for (const localeCandidate of navigator.languages) {
    const matchedLocale = normalizeLocale(localeCandidate)
    if (matchedLocale) {
      return matchedLocale
    }
  }

  return normalizeLocale(navigator.language) ?? FALLBACK_LOCALE
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function getInitialThemeMode(): ThemeMode {
  return readStoredThemeMode() ?? "system"
}

function resolveTheme(themeMode: ThemeMode, systemTheme: ResolvedTheme): ResolvedTheme {
  return themeMode === "system" ? systemTheme : themeMode
}

export function SitePreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<SiteLocale>(() => getInitialLocale())
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())

  const resolvedTheme = resolveTheme(themeMode, systemTheme)
  const copy = siteCopyByLocale[locale]
  const syncSystemTheme = useCallback((matches: boolean) => {
    setSystemTheme(matches ? "dark" : "light")
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleThemeChange = (event: MediaQueryListEvent) => {
      syncSystemTheme(event.matches)
    }

    mediaQuery.addEventListener("change", handleThemeChange)

    return () => {
      mediaQuery.removeEventListener("change", handleThemeChange)
    }
  }, [syncSystemTheme])

  useEffect(() => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    }
    catch {
      // Ignore storage failures.
    }
  }, [locale])

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    }
    catch {
      // Ignore storage failures.
    }
  }, [themeMode])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [locale, resolvedTheme])

  const value = useMemo<SitePreferencesValue>(() => {
    return {
      locale,
      setLocale,
      themeMode,
      setThemeMode,
      resolvedTheme,
      localeOptions: [...SITE_LOCALE_OPTIONS],
      themeModeOptions: THEME_MODE_OPTIONS.map(option => ({
        value: option.value,
        label: copy.common.themeMode[option.labelKey],
      })),
      copy,
      formatDate(timestamp, options) {
        return new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
          year: "numeric",
          ...options,
        }).format(timestamp)
      },
      getLanguageLabel(languageCode, fallback) {
        const normalizedCode = languageCode.trim()
        if (!normalizedCode) {
          return fallback ?? "English"
        }

        if (normalizedCode.toLowerCase() === "auto") {
          return fallback ?? "English"
        }

        const [languageCodePart, regionCodePart] = normalizedCode.split(LANGUAGE_CODE_SEGMENT_RE)
        try {
          const displayNames = typeof Intl.DisplayNames === "function"
            ? new Intl.DisplayNames([locale], { type: "language" })
            : null
          const languageLabel = displayNames?.of(languageCodePart) ?? languageCodePart.toUpperCase()

          return regionCodePart
            ? `${languageLabel} (${regionCodePart.toUpperCase()})`
            : languageLabel
        }
        catch {
          return fallback ?? normalizedCode.toUpperCase()
        }
      },
    }
  }, [copy, locale, resolvedTheme, themeMode])

  return (
    <SitePreferencesContext value={value}>
      {children}
    </SitePreferencesContext>
  )
}

export function useSitePreferences(): SitePreferencesValue {
  const context = use(SitePreferencesContext)
  if (!context) {
    throw new Error("useSitePreferences must be used inside SitePreferencesProvider.")
  }

  return context
}
