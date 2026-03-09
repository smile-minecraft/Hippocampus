# Hippocampus 醫療知識庫與考古題練習系統 - 架設與操作教學手冊

這是一份針對整體專案架構（Next.js + Postgres + Redis + MinIO）的完整部署與測試指南。

## 1. 系統環境與先決條件
- **作業系統**: macOS / Linux (Windows 建議使用 WSL2)
- **Node.js**: v18.17+ (建議使用 NVM 安裝 v20 LTS 或以上)
- **Docker & Docker Compose**: 由於專案深度依賴容器化資料庫與中介軟體，**必須安裝** Docker Desktop 或 OrbStack (Mac 推薦)。
- **外部 API 金鑰**: 需要 Google Gemini API Key 以驅動 AI 多模態解析引擎。

## 2. 啟動基礎容器服務 (Infrastructure)
本專案採用微服務化概念，資料庫 (PostgreSQL + pgvector)、快取與任務佇列 (Redis)、物件儲存 (MinIO) 皆透過 Docker Compose 統一管理。

1. 開啟終端機，進入專案根目錄 `/Hippocampus`。
2. 背景啟動基礎設施服務：
   ```bash
   docker compose up -d postgres redis minio minio-init
   ```
   > ⚠️ **注意**：我們僅單獨啟動基礎設施，尚未啟動 `web` 與 `worker`，因為本機開發時通常會直接在主機上執行 Node 處理程序，以便取得更佳的熱重載 (Hot Reload) 體驗及除錯支援。
3. 確認服務狀態：
   ```bash
   docker compose ps
   ```
   *註：`minio-init` 是負責建立 S3 bucket (`hippocampus-raw`, `hippocampus-assets`) 的短暫任務，執行完成後會顯示 `Exit 0`，此為預期中的正常現象。*
4. 前往本機 MinIO 控制台驗證物件儲存服務：
   - 網址: [http://localhost:9001](http://localhost:9001)
   - 預設帳號: `minioadmin`
   - 預設密碼: `minioadmin`

## 3. Web 服務環境設定 (Web App)
1. 進入前端系統模組：
   ```bash
   cd web
   ```
2. 安裝專案依賴套件：
   ```bash
   npm install
   ```
3. 環境變數設定：
   複製專案提供的 `.env.example`，以生成實際的 `.env` 設定檔：
   ```bash
   cp .env.example .env
   ```
   使用您習慣的編輯器開啟 `.env`，進行以下核心設定：
   - **DATABASE_URL**: 已預設連接本地 Docker 的 Postgres (`postgresql://hippocampus:...@localhost:5432/...`)，若您將 Node.js 運行在本地則不需更改，若全面使用 Docker 則需改為 `@postgres:5432`。
   - **REDIS_URL**: 已預設為 `redis://localhost:6379`。
   - **MINIO_ENDPOINT**: 若本機執行開發伺服器，**必須確保其值為 `localhost`**。
   - **GEMINI_API_KEY**: 填入您的 Google API Key，此為實踐系統解析與萃取管線（Pipeline）的核心。
   - **ENCRYPTION_KEY**: 填入隨機 64 字元的十六進位字串（用於加密 Notion API Token 第三方資料）。
   - **NEXTAUTH_SECRET**: 隨機密鑰，可執行 `openssl rand -base64 32` 生成。

## 4. 資料庫初始化與 Prisma 遷移
在正式啟動網路伺服器及 Worker 之前，必須與 PostgreSQL 進行結構同步並產生 Prisma Client 型別：
```bash
# 維持位於 web 目錄中
npx prisma generate
npx prisma db push
```
驗證資料庫連線並檢視表結構，可透過 Studio 工具：
```bash
npm run db:studio
# 將開啟於 http://localhost:5555
```

## 5. 啟動應用程式
系統架設採用分離式架構，將繁重的非同步任務（RAG 向量嵌入、PDF/Word 圖文分離處理）委派給獨立執行的 Worker 節點，因此您必須開啟 **兩個終端機視窗** 以分別啟動：

**終端機 1 (啟動背景處理 Worker):**
```bash
cd web
npm run worker
```

**終端機 2 (啟動 Next.js 網頁伺服器):**
```bash
cd web
npm run dev
```

啟動無誤後，打開瀏覽器存取 [http://localhost:3000](http://localhost:3000) 即可進入首頁。

## 6. 功能驗收與測試攻略 (Testing Strategy)
建置完畢後，建議您遵照以下流程進行核心模組測試，以確認系統架構完整性：

1. **圖文分離與解析管線測試 (Data Extraction Pipeline)**
   - 嘗試進入後台 / 文檔上傳介面。上傳一份帶有圖片以及雙欄排版（Double-column layout）的 PDF 教材。
   - 藉由 Polling (輪詢) 觀察處理進度。當解析完畢後，進入「人工審核站 (Staging Area)」。
   - 【前端功能驗證】：在左側原稿視圖中使用手指或滾輪雙指縮放圖片，利用預設的 Canvas API 進行人工裁切，並觀察裁切結果是否順利背景上傳至 MinIO 替換表單圖片佔位符。
2. **混合式動態權重刷題引擎 (Quiz Engine)**
   - 透過儀表板生成一份測驗卷，開始答題。
   - 【操作體驗驗證】：系統內建 Mousetrap 全域快捷鍵，測試純鍵盤操作（數字鍵點選選項、空白/Enter 繼續下一題）。
   - 【後端邏輯驗證】：故意連續答對或答錯，結束後查閱 `User_Question_Records` 中的權重變化，確認間隔重複（Spaced Repetition）演算法的作用。
3. **RAG 向量知識庫檢索**
   - 新增一筆醫療筆記（Wiki 條目），並進行存檔發布，此舉會觸發 Worker 將 Markdown 渲染為向量陣列寫入 pgvector。
   - 透過搜尋列或在答題詳解區塊，高光反白任意醫學同義詞以觸發「向量查詢」，確認系統能否召回高度相關的共筆段落以輔助學習。
