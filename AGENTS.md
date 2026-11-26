# Noticer 開發守則

## 專案名稱

專案叫 Noticer。

## 公開 repo

repo 會公開。測試、註解、範例文字與 i18n 只能用虛構的卡片、tag、紀錄與數值，不能用 `data/` 裡的真實資料；換成虛構情境時要保留原本的語意（哪些 tag 一起出現、數值是加總還是取最新）。開發時要用真實資料，就灌進 `data/`（不進版控）。

## 手機優先

- 每個操作都要能在手機上完成。電腦版可以多快捷鍵、多欄排版。例外：過度複雜的功能可以只在電腦上做。
- 先設計、實作、驗證窄版（< 600px），再往中（600–839）、寬（≥ 840）擴充。
- 點擊目標至少 44×44 px。
- 功能不能只靠 hover 才出現；拖曳、長按、滑動等手勢都要有看得見的替代操作。
- 版面要避開瀏海與底部手勢列（`env(safe-area-inset-*)`）。
- 驗證 UI 時以手機 viewport（390×844）為主，再看電腦寬度。

## 多語言

- 介面文字一律走 `t()`／`tn()`（`packages/web/src/i18n/`），不寫死在元件裡。`zh-TW.ts` 是 key 的來源，`en.ts`、`ja.ts` 以 `satisfies Messages` 檢查：少 key 或多 key 都過不了 typecheck。
- 日期、星期用 `Intl`（`time.ts`）；server 只回資料與代碼，不回顯示用的文字。
- 卡片名稱、tag、備註是使用者的資料，不翻譯。

## 設定都在 App 內

- 使用者能改的設定，全部要有 App 內的編輯介面。不能要求使用者改後端檔案、跑 CLI，或請 agent 代勞。
- 新增設定欄位時，同一個變更就要附上編輯它的 UI。
- 設定存在資料庫，改了立即生效，不需要重啟。
- CLI、API、MCP 可以是額外的入口，不能是唯一的入口。

## 結構

```
packages/server   Hono + zod + better-sqlite3；app.ts 匯出 AppType 給前端用 Hono RPC
packages/web      Vue 3 + vue-router 檔案路由（src/pages）+ Tailwind v4 + TanStack Query
data/             app.db（紀錄、tag、值，以及卡片與設定：cards／settings 存 JSON，裡面用 tag_id／unit_id）＋ attachments/（附件原檔與縮圖）；不進版控
```

## 指令

```
pnpm dev                          server :3040 + web :5174
pnpm test                         Vitest
pnpm typecheck                    tsc（server）+ vue-tsc（web）
pnpm --filter web icons           從 packages/web/icon/ 的兩個 SVG 產生 public/ 裡所有尺寸的 icon
pnpm import-backup <backup-dir>   開發用：用舊版的月份備份 JSON（含 config.json）重灌 data/，舊版的 tracker 會轉成 rules；備份不含附件，會清空 attachments/
pnpm pull-prod <old-app-url>      開發用：從舊版的 API 拉最新的 events、設定與圖片，重灌 data/，舊版的 tracker 會轉成 rules
```

一天的切點用 server 程序的本地時區（`TZ`）。
