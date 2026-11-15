// Kiểu của thư viện skill (plugin): server/plugins.ts dựng, ui/pluginsui.tsx, ui/ghadd.tsx và shared/plugindir.ts đọc.
// Chỉ có kiểu (xóa khi biên dịch): mô-đun gốc xuất lại các kiểu này nên mã đang nhập từ đó không đổi.

// Từ server/plugins.ts.
export type Studio = "design" | "slides" | "docs";
// Nút studio của một plugin: auto: Synchro tự xếp từng skill vào các mục (mặc định); none: không vào mục nào; tên mục: cả thư viện vào nút đó.
export type StudioMode = "auto" | "none" | Studio;
export type Source = { repo: string; ref?: string; path?: string; include?: string[]; exclude?: string[] };
export type PluginDef = { catalogId?: string; slug: string; name: string; description: string; author?: string; homepage?: string; studio?: Studio | null; everywhere?: boolean; color?: string; sources: Source[] };
export type Risk = "none" | "low" | "medium" | "high";
export type SkillReport = { name: string; description: string; dir: string; repo: string; files: number; size: number; scripts: number; license: string; licenseKind: LicenseKind; risk: Risk; flags: string[]; blocked?: string; duplicateOf?: string };
export type LicenseKind = "open" | "proprietary" | "unknown";
export type Preview = { def: PluginDef; skills: SkillReport[]; commits: Record<string, string>; size: number; installable: number };
export type PluginSkill = { id: string; name: string; description: string; enabled: boolean; report: SkillReport; useCount: number; lastUsed: number | null };
export type PublicPlugin = {
  id: string; scope: "org" | "personal"; slug: string; catalogId: string | null; name: string; description: string; author: string | null; homepage: string | null; color: string | null;
  studio: Studio | null; studioMode: StudioMode; everywhere: boolean; enabled: boolean; mine: { enabled: boolean; everywhere: boolean }; sources: Source[]; commits: Record<string, string>; size: number;
  updatedAt: number; checkedAt: number | null; updateAvailable: boolean; skills: PluginSkill[];
  risk: Risk; licenses: string[];
  /** Số skill của thư viện này đã nằm trong từng mục (Tự động nhận diện, và mục người dùng tự chọn). */
  detected?: Partial<Record<Studio, number>>;
};
// Danh sách thư viện (Kho kỹ năng, menu +, bảng lệnh): mỗi skill chỉ có tên và trạng thái. Thư viện chung có thể chứa cả danh mục của Claude
// (~3.100 thư viện, ~18.000 skill): gửi đủ mô tả và báo cáo của mọi skill mỗi lần mở trang là vài chục MB. Chi tiết: getPlugin (GET /api/plugins/[id]).
export type PluginSummary = Omit<PublicPlugin, "skills"> & { skills: { id: string; name: string; enabled: boolean; useCount: number }[] };
export type StudioInfo = { name: string; skills: number; autoTotal: number; catalogLibs: number; auto: { name: string; from: string }[] };
