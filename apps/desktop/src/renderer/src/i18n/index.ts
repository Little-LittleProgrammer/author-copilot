import { useCallback, useEffect, useState } from "react";

export type Locale = "en-US" | "zh-CN";

const messages = {
  "en-US": {
    aiChat: "AI chat",
    aiUnavailable:
      "AI chat will be available after the local writing workflow is complete.",
    appName: "Author Copilot",
    changeReview: "Change review",
    changesUnavailable:
      "Version changes will be available when Git support is enabled.",
    close: "Close",
    content: "Content",
    create: "Create",
    createHint: "Choose a folder and create a clean, local writing project.",
    createNovel: "New novel",
    createProject: "Create project",
    createScreenplay: "New screenplay",
    darkTheme: "Dark theme",
    discard: "Discard changes",
    discardPrompt: "Discard the unsaved changes and continue?",
    documentChanged:
      "This file changed on disk. Your edits are still here; reload before saving again.",
    duplicateProject:
      "This project ID is already registered elsewhere. Confirm again to register this folder as an independent copy.",
    documentEmpty: "Choose a Markdown document from the structure tree.",
    documentPlaceholder: "Start writing…",
    editor: "Editor",
    errorGeneric: "Something went wrong. Try again.",
    import: "Import",
    importConfirm: "Import project",
    importCopy: "Copy into a new project",
    importHint: "Review the detected Markdown structure before registering it.",
    importInPlace: "Register folder in place",
    importMode: "Import mode",
    importNoPreview: "No folder was selected.",
    importProject: "Import Markdown",
    importTitle: "Import Markdown folder",
    importing: "Inspecting folder…",
    language: "Language",
    lightTheme: "Light theme",
    loading: "Loading…",
    location: "Parent folder",
    locationPlaceholder: "/Users/me/Documents",
    locationPickerHint: "A folder picker will open after you choose Create.",
    name: "Project name",
    namePlaceholder: "Untitled story",
    noProjects: "No projects yet",
    noProjectsHint:
      "Create a novel or screenplay, or bring in an existing Markdown folder.",
    previewFiles: "Markdown files",
    project: "Project",
    projectApiUnavailable: "Project services are not available in this build.",
    projectTypeNovel: "Novel",
    projectTypeScreenplay: "Screenplay",
    projects: "Projects",
    recognizedStructure: "Recognized structure",
    registerCopy: "Register independent copy",
    reload: "Reload from disk",
    save: "Save",
    saved: "Saved",
    saving: "Saving…",
    selectFolder: "Choose folder…",
    structure: "Structure",
    theme: "Theme",
    unclassified: "Unclassified Markdown",
    unsaved: "Unsaved changes",
  },
  "zh-CN": {
    aiChat: "AI 对话",
    aiUnavailable: "本地写作闭环完成后将启用 AI 对话。",
    appName: "Author Copilot",
    changeReview: "变更审阅",
    changesUnavailable: "启用 Git 能力后可在这里审阅版本变更。",
    close: "关闭",
    content: "正文",
    create: "创建",
    createHint: "选择父目录，创建一个干净的本地写作项目。",
    createNovel: "新建小说",
    createProject: "新建项目",
    createScreenplay: "新建剧本",
    darkTheme: "深色主题",
    discard: "放弃修改",
    discardPrompt: "放弃当前未保存的修改并继续吗？",
    documentChanged: "文件已被外部修改。当前编辑仍保留，请重新加载后再保存。",
    duplicateProject:
      "该项目 ID 已在其他目录登记。再次确认可将当前文件夹登记为独立副本。",
    documentEmpty: "请从作品结构中选择一个 Markdown 文档。",
    documentPlaceholder: "开始写作…",
    editor: "编辑器",
    errorGeneric: "操作失败，请重试。",
    import: "导入",
    importConfirm: "确认导入",
    importCopy: "复制为新项目",
    importHint: "登记项目前，请确认识别到的 Markdown 结构。",
    importInPlace: "就地登记文件夹",
    importMode: "导入方式",
    importNoPreview: "未选择文件夹。",
    importProject: "导入 Markdown",
    importTitle: "导入 Markdown 文件夹",
    importing: "正在检查文件夹…",
    language: "语言",
    lightTheme: "浅色主题",
    loading: "加载中…",
    location: "父目录",
    locationPlaceholder: "/Users/me/Documents",
    locationPickerHint: "点击创建后，将由系统选择父目录。",
    name: "项目名称",
    namePlaceholder: "未命名作品",
    noProjects: "还没有项目",
    noProjectsHint: "新建小说或剧本，也可以导入已有 Markdown 文件夹。",
    previewFiles: "Markdown 文件",
    project: "项目",
    projectApiUnavailable: "当前版本尚未接入项目服务。",
    projectTypeNovel: "小说",
    projectTypeScreenplay: "剧本",
    projects: "项目",
    recognizedStructure: "识别到的结构",
    registerCopy: "登记为独立副本",
    reload: "从磁盘重新加载",
    save: "保存",
    saved: "已保存",
    saving: "保存中…",
    selectFolder: "选择文件夹…",
    structure: "作品结构",
    theme: "主题",
    unclassified: "未分类 Markdown",
    unsaved: "未保存",
  },
} as const;

export type MessageKey = keyof (typeof messages)["zh-CN"];

function initialLocale(): Locale {
  const stored = localStorage.getItem("author-copilot.locale");
  if (stored === "en-US" || stored === "zh-CN") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function useI18n(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
} {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("author-copilot.locale", locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const t = useCallback((key: MessageKey) => messages[locale][key], [locale]);
  return { locale, setLocale, t };
}
