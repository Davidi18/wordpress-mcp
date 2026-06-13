# Changelog

כל השינויים המשמעותיים בפרויקט WordPress MCP Hub מתועדים כאן.

הפורמט מבוסס על [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### ✨ Added
- **תמיכת Elementor 4.0 "atomic" (V4)** — מודול פורמט חדש `elementor-atomic.js` שבונה את אלמנטי ה-V4 (מערכת ה-`$$type`, local style classes, ומבנה ה-atomic) שתואם למה ש-Elementor 4.0 שומר ב-`_elementor_data`. הידע פורט מ-[`msrbuilds/elementor-mcp`](https://github.com/msrbuilds/elementor-mcp). כולל חבילת בדיקות `node:test` (הרצה: `npm test`).
- **`wp_elementor_add_atomic`** — כלי חדש שבונה אלמנט atomic מפרמטרים שטוחים (בלי לכתוב ביד את ה-JSON העטוף ב-`$$type`): קונטיינרים `e-flexbox`/`e-div-block` (עם layout כ-local style class) ו-widgets `e-heading`/`e-paragraph`/`e-button`/`e-image`/`e-svg`/`e-youtube`/`e-self-hosted-video`/`e-divider`. כולל בדיקת-תמיכה לפני כתיבה כדי לא לכתוב data ש-Elementor ישמיט בשקט.
- **זיהוי תמיכת atomic** — route חדש `agency-os/v1/elementor-atomic-status` (נוסף ל-snippet של `wp_bootstrap_elementor_writer`) שמדווח אם סוגי ה-atomic רשומים/הניסוי פעיל. `wp_elementor_capabilities` מחזיר כעת שדה `atomic`. הזיהוי אינו מבוסס מספר-גרסה (ELEMENTOR_VERSION נשאר 3.x גם כשהניסוי דולק).
- **`wp_elementor_get_widget_settings`** מחזיר כעת `settings_readable` (ערכים שטוחים וקריאים) ו-`is_atomic` עבור אלמנטי V4.

### 🔧 Changed
- ה-route `agency-os/v1/elementor-data` מטביע כעת `_elementor_version` ומנקה את מטמון ה-CSS (`files_manager->clear_cache`) אחרי כתיבה, כדי ש-CSS של atomic local-classes ייווצר מחדש. הכתיבה נשארת raw-meta (לא `Document::save`) כדי שאלמנטי V4 יישמרו byte-for-byte ולא יעברו סניטציה.

### 🔧 Fixed
- **`wp_create_redirect` עם תוסף Redirection** — הכלי החזיר בטעות `No redirect plugin found` למרות שתוסף Redirection פעיל והרדיירקט אכן נוצר. הסיבה: endpoint היצירה של Redirection (`POST /redirection/v1/redirect`) מחזיר את **רשימת** הרדיירקטים המעודכנת (`{ items, total, pages }`) ולא אובייקט בודד עם `id`. הקוד בדק `result.id` ולכן נפל ל-fallback. כעת מזוהה גם תגובת רשימה (מאתר את הרשומה החדשה לפי `url`), וההודעה הסופית כוללת `attempts` עם פירוט הכשל לכל תוסף.
- **`wp_get_redirects` החזיר `total` חיובי אך `redirects: []`** — REST API של תוסף Redirection משתמש בעימוד מבוסס-0, אך הכלי שלח `page` ברירת מחדל 1, כלומר העמוד ה**שני** שהיה ריק. כעת `page` (1-based מהקורא) מתורגם ל-0-based, ונתמך גם חיפוש דרך `filterBy[url]`.

## [3.1.0] - 2026-06-01

### ✨ Added
- **Privileged Elementor write route** — endpoint חדש `agency-os/v1/elementor-data` שמעדכן את `_elementor_data` ישירות דרך `update_post_meta` מאחורי בדיקת הרשאת `edit_post`. כל הכלים שכותבים `_elementor_data` (`wp_elementor_create_page`, `wp_elementor_update_page`, `wp_elementor_update_from_file`, `wp_elementor_insert_block`, `wp_elementor_insert_widget`, `wp_elementor_update_widget`, `wp_elementor_duplicate_widget`, `wp_publish_draft_over`, `wp_replace_text`, `wp_restore_page_state`) עוברים דרכו, עם fallback אוטומטי לכתיבת meta הרגילה של core כשה-route לא מותקן. פותר את המצב שבו read עבד אבל write נפל בגלל הגבלות core REST על protected meta.
- **`wp_bootstrap_elementor_writer`** — מתקין את ה-route הפריבילגי כ-**Code Snippet פעיל**, בלי mu-plugin ובלי כתיבת קובץ לדיסק (דרך ההתקנה המומלצת). idempotent. אותו route מגיע גם ב-mu-plugin של ה-File API עבור אתרים שכבר משתמשים בו.
- **תמיכת excerpt בעמודים** — `wp_update_page` ו-`wp_create_page` מקבלים כעת `excerpt`. העברת `excerpt: ""` ל-`wp_update_page` מנקה excerpt קיים מעמוד.
- **ניהול Code Snippets** — כלים חדשים `wp_list_snippets`, `wp_get_snippet`, `wp_create_snippet`, `wp_update_snippet`, `wp_activate_snippet`, `wp_deactivate_snippet`, `wp_delete_snippet` שעוטפים את ה-REST API של תוסף Code Snippets. מאפשר להתקין snippet של guard בלי mu-plugin.

### 🔧 Changed
- `wp_bootstrap_file_api` בודק כעת גם את קיום ה-route של `elementor-data` ומשדרג את ה-mu-plugin כשהוא חסר (במקום לעצור על "already installed").
- `wp_check_file_api` מחזיר `elementor_write_route` שמציין אם ה-route הפריבילגי מותקן.

## [3.0.1] - 2025-10-05

### 🔧 Fixed
- **תיקון קריטי**: הרצת WordPress MCP instances דרך mcp-proxy בצורה תקינה
  - שינוי פקודת ההרצה ב-entrypoint.sh מ-`npx @automattic/mcp-wordpress-remote` ל-`mcp-wordpress-remote`
  - הוספת `--` separator נכון בין mcp-proxy לפקודת MCP
- **שיפור טיפול ב-JSON responses**
  - הסרת ניתוח SSE שגוי מפונקציית `rpc()`
  - שיפור error handling עם הודעות שגיאה ברורות יותר
  - הוספת logging טוב יותר לשגיאות JSON parsing
- **שיפור בדיקות upstreams**
  - הוספת timeout של 5 שניות לבדיקת `/debug/upstreams`
  - החזרת מידע מפורט יותר על כל WordPress MCP (health data)
- **תיקוני error handling**
  - הוספת `body.id` לכל תגובות שגיאה
  - שיפור הודעות שגיאה להיות יותר ידידותיות למשתמש

### 📚 Documentation
- **README.md**: תיעוד מקיף בעברית ואנגלית
  - הסבר על ארכיטקטורה
  - הוראות התקנה מפורטות
  - פתרון בעיות נפוצות
  - דוגמאות שימוש
- **QUICKSTART-N8N.md**: מדריך התחלה מהירה
  - 3 צעדים פשוטים להתקנה
  - חיבור ישיר ל-n8n
  - דוגמאות workflow מוכנות לשימוש
  - פתרון בעיות נפוצות
- **USE-CASES.md**: 9 use cases מעשיים
  - פרסום תוכן אוטומטי
  - סנכרון בין אתרים
  - ניהול מדיה
  - דוחות אנליטיקס
  - ניהול תגובות
  - עדכונים מרובים
  - גיבוי לענן
  - SEO optimization
  - Multi-site publishing

### ✨ Improved
- **Aggregator logging**
  - מידע מפורט יותר על clients רשומים
  - tracking טוב יותר של ביצועים
- **Health check endpoint**
  - הוספת מידע על analytics ו-cache stats
  - גרסה מעודכנת (3.0.1)
- **Documentation endpoint** (`/docs`)
  - UI משופר עם RTL support
  - הוספת רשימת debug endpoints
  - עיצוב נקי ומודרני

## [3.0.0] - 2025-10-04

### 🎉 Added - Initial Multi-Client Release
- **Multi-Client Architecture**
  - תמיכה בעד 15 לקוחות WordPress בו-זמנית
  - נקודת קצה אחת (`/mcp`) לכל הלקוחות
  - זיהוי לקוח דינמי דרך `X-Client-ID` header
  - ניתוב אוטומטי לWordPress MCP הנכון

- **Aggregator Layer** (`aggregator.js`)
  - מנהל את כל הבקשות ומנתב ללקוח הנכון
  - Rate limiting מובנה
  - Smart caching
  - Analytics ומעקב
  - Authentication support עם token

- **Rate Limiting** (`rate-limiter.js`)
  - הגבלת קריאות לפי לקוח
  - הגבלת קריאות לפי tool
  - Headers: `X-RateLimit-Remaining`, `Retry-After`
  - הגנה מפני שימוש יתר

- **Caching System** (`cache-manager.js`)
  - Cache חכם של תוצאות זהות
  - TTL configurable
  - Headers: `X-Cache: HIT/MISS`
  - חיסכון בקריאות מיותרות ל-WordPress

- **Analytics & Logging** (`analytics-logger.js`)
  - מעקב אחר כל הבקשות
  - ביצועים לפי לקוח
  - שגיאות ו-timeouts
  - Performance metrics

- **Docker Support**
  - Dockerfile מותאם
  - Multi-stage build
  - Health checks
  - Alpine Linux base (קטן ומהיר)

- **Debug & Monitoring Endpoints**
  - `/health` - בדיקת בריאות המערכת
  - `/clients` - רשימת לקוחות רשומים
  - `/debug/upstreams` - בדיקת חיבור לכל WordPress MCP
  - `/stats?client=NAME` - סטטיסטיקות לפי לקוח
  - `/analytics?minutes=60` - אנליטיקס של 60 דקות אחרונות
  - `/` - תיעוד אינטראקטיבי עם UI

### 🏗️ Architecture
```
┌─────────────┐
│   n8n/AI    │
└──────┬──────┘
       │
┌──────▼──────────────────────┐
│  Aggregator (Port 9090)     │
│  - Routing                  │
│  - Rate Limiting            │
│  - Caching                  │
│  - Analytics                │
└──────┬──────────────────────┘
       │
       ├─→ WP MCP 1 (Port 9101)
       ├─→ WP MCP 2 (Port 9102)
       └─→ WP MCP N (Port 910N)
```

### 🔐 Security Features
- Optional authentication עם `AUTH_TOKEN`
- Rate limiting למניעת abuse
- Validation של client IDs
- Error handling מאובטח (ללא חשיפת מידע רגיש)

### 📦 Dependencies
- `@automattic/mcp-wordpress-remote@latest` - WordPress MCP המקורי
- `mcp-proxy@latest` - Proxy layer
- Node.js 22 Alpine

### 🌐 Environment Variables
- `WP{1-15}_URL` - WordPress REST API URL
- `WP{1-15}_USER` - WordPress username
- `WP{1-15}_APP_PASS` - WordPress Application Password
- `CLIENT{1-15}_NAME` - שם הלקוח (אופציונלי)
- `AUTH_TOKEN` - Token לאימות (אופציונלי)

## [2.x.x] - Before Multi-Client Support

### Context
גרסאות קודמות השתמשו ב-WordPress MCP המקורי של Automattic ללא תמיכה multi-client.
כל לקוח דרש instance נפרד עם URL וcredentials נפרדים.

---

## תכנון עתידי

### [3.1.0] - Planned
- [ ] WebSocket support לupdates בזמן אמת
- [ ] Prometheus metrics endpoint
- [ ] Configuration UI
- [ ] Client-specific rate limits
- [ ] Custom cache TTL per tool
- [ ] Webhook support למניעת polling

### [3.2.0] - Ideas
- [ ] GraphQL endpoint
- [ ] Batch operations support
- [ ] Transaction support (rollback אם נכשל)
- [ ] Multi-language content sync
- [ ] Advanced analytics dashboard
- [ ] Auto-scaling based on load

---

## Contributing

מעוניין לתרום? ראה [CONTRIBUTING.md](CONTRIBUTING.md)

## Support

- 🐛 [Report Issues](https://github.com/Davidi18/wordpress-mcp/issues)
- 💬 [Discussions](https://github.com/Davidi18/wordpress-mcp/discussions)
- 📧 Email: support@example.com

---

**Legend:**
- 🎉 Added - תכונות חדשות
- 🔧 Fixed - תיקוני באגים
- ✨ Improved - שיפורים
- 🔐 Security - תיקוני אבטחה
- 📚 Documentation - שינויי תיעוד
- 🏗️ Architecture - שינויים ארכיטקטוניים
