# WordPress MCP Server v3.0 - Enhanced Edition with HTTP API + Schema Management

## 🎉 What's New in v3.0

**NEW: Strudel Schema Plugin + MCP Tools** - Manage JSON-LD schema markup across your WordPress sites!

### v3.0 Features:
- ✨ **Schema Management** - 4 new MCP tools for JSON-LD schema control
- ✨ **Strudel Schema Plugin** - Bundled WordPress plugin for per-page schema management
- 🎯 **Template System** - Pre-built templates for Service, AboutPage, FAQ, BlogPosting, and more
- 🔄 **Override Mode** - Automatically disables Yoast/Rank Math schemas when needed
- 📡 **REST API** - Full schema control via WordPress REST API

### v2.2 Features:
- ✨ **Special Pages API** - `wp_get_special_pages` endpoint for homepage, blog, and privacy policy pages
- ✨ **Enhanced Site Info** - `wp_get_site_info` now includes special page IDs and reading settings
- 🏠 **Homepage Detection** - Automatically detects static homepage or posts listing
- 📝 **Blog Page ID** - Get the blog listing page when using static homepage
- 🔒 **Privacy Policy Page** - Direct access to privacy policy page details

### v2.1 Features:
- ✨ **HTTP REST API** - `GET /api/find` endpoint for direct queries
- ✨ **Unified Search** - Automatically searches both posts AND pages in one call
- ✨ **Multi-Client Support** - Query different WordPress sites using client parameter
- 🤖 **Auto-Detection** - Automatically detects client from URL domain (no manual client parameter needed!)
- ✨ **API Key Authentication** - Secure your endpoint with shared API key
- ✨ **Flexible Search** - Find content by slug, full URL, or text search

### v2.0 Features:
**36 Total Endpoints** (up from 18) - **100% increase in functionality!**

### New Features Added:

#### 📝 Media Management - COMPLETE
- ✅ `wp_get_media` - List all media files
- ✅ `wp_get_media_item` - Get specific media item
- ✅ `wp_upload_media` - Upload new media
- ✨ **NEW** `wp_update_media` - Update metadata (title, alt text, caption, description)
- ✨ **NEW** `wp_delete_media` - Delete media files

#### 💬 Comments - FULL CRUD
- ✨ **NEW** `wp_get_comments` - List comments with filters
- ✨ **NEW** `wp_get_comment` - Get specific comment
- ✨ **NEW** `wp_create_comment` - Create new comments
- ✨ **NEW** `wp_update_comment` - Update comment content/status
- ✨ **NEW** `wp_delete_comment` - Delete comments

#### 👥 Users
- ✨ **NEW** `wp_get_users` - List all users
- ✨ **NEW** `wp_get_user` - Get specific user details
- ✨ **NEW** `wp_get_current_user` - Get authenticated user info

#### 🏷️ Taxonomy - FULL CRUD
- ✅ `wp_get_categories` - List categories
- ✅ `wp_get_tags` - List tags
- ✨ **NEW** `wp_create_category` - Create new categories
- ✨ **NEW** `wp_create_tag` - Create new tags
- ✨ **NEW** `wp_update_category` - Update category details
- ✨ **NEW** `wp_delete_category` - Delete categories

#### ⚙️ Site Information
- ✨ **NEW** `wp_get_site_info` - Get site settings and configuration
- ✨ **NEW** `wp_get_post_types` - List all available post types

---

## 📊 Complete Endpoint Coverage

### Posts (5 endpoints)
- `wp_get_posts` - List posts with filters
- `wp_get_post` - Get single post
- `wp_create_post` - Create new post
- `wp_update_post` - Update existing post
- `wp_delete_post` - Delete post

### Pages (5 endpoints)
- `wp_get_pages` - List pages
- `wp_get_page` - Get single page
- `wp_create_page` - Create new page
- `wp_update_page` - Update existing page
- `wp_delete_page` - Delete page

### Media (5 endpoints) ✨
- `wp_get_media` - List media files
- `wp_get_media_item` - Get single media item
- `wp_upload_media` - Upload new media
- **`wp_update_media`** ← NEW!
- **`wp_delete_media`** ← NEW!

### Comments (5 endpoints) ✨ ALL NEW!
- **`wp_get_comments`** - List comments
- **`wp_get_comment`** - Get single comment
- **`wp_create_comment`** - Create new comment
- **`wp_update_comment`** - Update comment
- **`wp_delete_comment`** - Delete comment

### Users (3 endpoints) ✨ ALL NEW!
- **`wp_get_users`** - List all users
- **`wp_get_user`** - Get user details
- **`wp_get_current_user`** - Get current user

### Custom Post Types (3 endpoints)
- `wp_get_custom_posts` - List custom posts
- `wp_get_custom_post` - Get single custom post
- `wp_create_custom_post` - Create custom post

### Taxonomy (6 endpoints) ✨ 4 NEW!
- `wp_get_categories` - List categories
- `wp_get_tags` - List tags
- **`wp_create_category`** ← NEW!
- **`wp_create_tag`** ← NEW!
- **`wp_update_category`** ← NEW!
- **`wp_delete_category`** ← NEW!

### Site Info (3 endpoints) ✨ ALL NEW!
- **`wp_get_site_info`** - Site settings including special page IDs
- **`wp_get_special_pages`** - Get homepage, blog page, privacy policy page IDs
- **`wp_get_post_types`** - Available post types

### Schema Management (4 endpoints) ✨ NEW in v3.0!
- **`wp_get_schema`** - Get schema config for a page/post
- **`wp_set_schema`** - Set JSON-LD schema (template or custom)
- **`wp_list_schemas`** - List all pages with schema configured
- **`wp_preview_schema`** - Preview rendered schema without saving

---

## 📋 Schema Management (Strudel Schema)

### Installation

1. Download `strudel-schema.zip` from the repo
2. WordPress Admin → Plugins → Add New → Upload Plugin
3. Activate "Strudel Schema"

### Quick Start

```javascript
// Set schema for a service page
wp_set_schema({
  id: 123,
  template: 'service',
  data: {
    service_name: 'קידום אתרים',
    service_description: 'שירותי SEO מקצועיים',
    area_served: 'IL'
  }
})

// Set FAQ schema
wp_set_schema({
  id: 456,
  template: 'faq',
  data: {
    faqs: [
      { question: 'כמה זה עולה?', answer: 'תלוי בהיקף הפרויקט' },
      { question: 'כמה זמן לוקח?', answer: '3-6 חודשים לתוצאות' }
    ]
  }
})

// Custom JSON-LD override
wp_set_schema({
  id: 789,
  template: 'custom',
  override_json: {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Custom Page"
  }
})
```

### Available Templates

| Template | Use Case | Key Fields |
|----------|----------|------------|
| `service` | Service pages | `service_name`, `service_description`, `area_served` |
| `about` | About pages | `organization_id` |
| `blog` | Blog posts | Auto-filled from post data |
| `faq` | FAQ pages | `faqs` (array of Q&A) |
| `course` | Course pages | `course_name`, `start_date`, `end_date` |
| `local` | Local business | `business_name`, `telephone`, `address` |
| `product` | Product pages | `product_name`, `price`, `sku` |
| `custom` | Full control | Use `override_json` |

### Global Settings

Go to **Settings → Strudel Schema** in WordPress to configure:
- Organization details (name, logo, phone, email, social links)
- Website schema
- Default behavior

---

## 🚀 Usage Examples

### Update Media Metadata
```javascript
{
  "tool": "wp_update_media",
  "args": {
    "id": 123,
    "title": "Beautiful Sunset",
    "alt_text": "A stunning sunset over the ocean",
    "caption": "Taken at Santa Monica Beach",
    "description": "High-resolution sunset photograph"
  }
}
```

### Create and Manage Comments
```javascript
// Create comment
{
  "tool": "wp_create_comment",
  "args": {
    "post": 42,
    "content": "Great article!",
    "author_name": "John Doe",
    "author_email": "john@example.com"
  }
}

// Update comment status
{
  "tool": "wp_update_comment",
  "args": {
    "id": 15,
    "status": "approve"
  }
}
```

### Manage Categories
```javascript
// Create category
{
  "tool": "wp_create_category",
  "args": {
    "name": "Technology",
    "description": "Tech-related articles",
    "slug": "tech"
  }
}

// Update category
{
  "tool": "wp_update_category",
  "args": {
    "id": 5,
    "name": "Tech & Innovation",
    "parent": 2
  }
}
```

### Get Site Information
```javascript
{
  "tool": "wp_get_site_info",
  "args": {}
}
// Returns: title, description, url, timezone, language,
// show_on_front, page_on_front, page_for_posts, etc.
```

### Get Special Pages (Homepage, Blog, Privacy Policy)
```javascript
{
  "tool": "wp_get_special_pages",
  "args": {}
}
// Returns full details of special pages:
// {
//   "homepage": { id: 5, title: "Home", slug: "home", url: "...", status: "publish", type: "page" },
//   "blog_page": { id: 8, title: "Blog", slug: "blog", url: "...", status: "publish", type: "page" },
//   "privacy_policy": { id: 3, title: "Privacy Policy", slug: "privacy-policy", url: "...", status: "publish", type: "page" },
//   "_settings": { show_on_front: "page", posts_per_page: 10, default_category: 1 }
// }
```

---

## 📈 API Coverage Statistics

| Content Type | Before v2.0 | After v2.0 | Coverage |
|--------------|-------------|------------|----------|
| Posts | 5 endpoints | 5 endpoints | 100% ✅ |
| Pages | 5 endpoints | 5 endpoints | 100% ✅ |
| Media | 3 endpoints | 5 endpoints | 100% ✅ |
| Comments | 0 endpoints | 5 endpoints | 100% ✨ |
| Users | 0 endpoints | 3 endpoints | 75% ✨ |
| Taxonomy | 2 endpoints | 6 endpoints | 100% ✨ |
| Custom Posts | 3 endpoints | 3 endpoints | 100% ✅ |
| Site Info | 0 endpoints | 3 endpoints | NEW ✨ |
| **TOTAL** | **18 endpoints** | **36 endpoints** | **100% more!** |

---

## 🌐 HTTP API Usage (Enhanced in v2.2!)

### Available Endpoints

The HTTP API provides 4 powerful endpoints:

| Endpoint | Description | Parameters | Recommended |
|----------|-------------|------------|-------------|
| `GET /api/site-data` | **Get everything in one call** - site info + special pages | `client` (optional) | ⭐ **YES** |
| `GET /api/find` | **Universal search** - Find ANY content by ID, slug, URL, or text | `id`, `slug`, `url`, `search`, `client` | ⭐ **YES** |
| `GET /api/special-pages` | Get special pages only (homepage, blog, privacy) | `client` (optional) | |
| `GET /api/site-info` | Get site settings only | `client` (optional) | |

### Quick Start

#### ⭐ Recommended: Get Everything in One Call
```bash
# Get site info + special pages in a single request
curl -H "X-API-Key: your-secret-key" \
     "http://localhost:8080/api/site-data"
```

**Response includes:**
- Complete site settings (title, url, timezone, reading settings, etc.)
- All special pages (homepage, blog page, privacy policy)
- Returned in one optimized call

#### 1. Find Posts/Pages
```bash
# Basic search by slug
curl -H "X-API-Key: your-secret-key" \
     "http://localhost:8080/api/find?slug=about-us"
```

#### 2. Get Special Pages Only
```bash
# Get homepage, blog page, and privacy policy page IDs
curl -H "X-API-Key: your-secret-key" \
     "http://localhost:8080/api/special-pages"
```

#### 3. Get Site Information Only
```bash
# Get site settings including special page IDs
curl -H "X-API-Key: your-secret-key" \
     "http://localhost:8080/api/site-info"
```

#### Multi-Client Requests
```bash
# Query specific WordPress site
curl -H "X-API-Key: your-secret-key" \
     "http://localhost:8080/api/site-data?client=client1"
```

### Search Parameters

You can search using **any** of these parameters - the API will find your content regardless of type:

| Parameter | Description | Example | Finds |
|-----------|-------------|---------|-------|
| `id` | Find by WordPress ID (direct lookup) | `?id=42` | Posts, Pages |
| `slug` | Find by WordPress slug | `?slug=about-us` | Posts, Pages, Special Pages |
| `url` | Find by full URL (slug extracted) | `?url=https://site.com/about-us` | Posts, Pages, Special Pages |
| `search` | Text search in title/content | `?search=contact` | Posts, Pages |
| `client` | Specify which WordPress site | `&client=client1` | Multi-site selection |

**Special Pages Detection:**
The API automatically detects special WordPress pages:
- Homepage (by slug match or keywords: `home`, `homepage`)
- Blog page (by slug match or keyword: `blog`)
- Privacy policy (by slug match or keywords: `privacy`, `privacy-policy`)

### Response Format

#### Success Response (Found - Regular Content)
```json
{
  "found": true,
  "type": "page",
  "id": 42,
  "title": "About Us",
  "slug": "about-us",
  "content": "<p>Welcome to our site...</p>",
  "url": "https://yoursite.com/about-us",
  "date": "2024-01-15T10:30:00",
  "status": "publish",
  "_meta": {
    "client": "client1",
    "autoDetected": true
  }
}
```

#### Success Response (Found - Special Page)
```json
{
  "found": true,
  "type": "page",
  "specialType": "homepage",
  "id": 5,
  "title": "Home",
  "slug": "home",
  "content": "<p>Welcome to our homepage...</p>",
  "url": "https://yoursite.com/",
  "date": "2024-01-15T10:30:00",
  "status": "publish",
  "isSpecialPage": true,
  "_meta": {
    "client": "default",
    "autoDetected": false
  }
}
```

**Special page types:**
- `"homepage"` - Static homepage
- `"blog_page"` - Blog listing page
- `"privacy_policy"` - Privacy policy page

**Note:** `_meta.autoDetected` will be `true` if the client was detected from the URL domain, or `false` if manually specified via `&client=` parameter.

#### Not Found Response
```json
{
  "found": false,
  "message": "Content not found in posts or pages",
  "searchParams": {
    "slug": "non-existent-page"
  }
}
```

#### Error Response (Missing API Key)
```json
{
  "error": "Unauthorized: Invalid API Key"
}
```

### Real-World Examples

#### Example 1: Find by ID (fastest - direct lookup)
```bash
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/find?id=42"
# Returns: Post or Page with ID 42 with full details
```

#### Example 2: Find homepage (special page detection)
```bash
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/find?slug=home"
# Returns: Homepage with specialType: "homepage", isSpecialPage: true
```

#### Example 3: Find blog page
```bash
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/find?slug=blog"
# Returns: Blog page with specialType: "blog_page", isSpecialPage: true
```

#### Example 4: Find privacy policy
```bash
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/find?slug=privacy-policy"
# Returns: Privacy policy page with specialType: "privacy_policy", isSpecialPage: true
```

#### Example 5: Find any page by slug
```bash
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/find?slug=about-us"
# Returns: Regular page or post matching the slug
```

#### Example 6: Find content by full URL (with auto-detection!)
```bash
# The system automatically detects the client from the domain
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/find?url=https://mysite.com/blog/my-post"

# No need to specify &client=... - it's detected automatically!
# If mysite.com matches CLIENT1_WP_API_URL, it will use client1 credentials
```

#### Example 7: Text search across all content
```bash
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/find?search=contact%20us"
# Returns: First match in posts or pages containing "contact us"
```

#### Example 8: Query specific client
```bash
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/find?slug=about&client=client2"
```

---

### 🆕 New Endpoints (v2.2)

#### ⭐ GET /api/site-data (RECOMMENDED)

Get **everything** you need about your WordPress site in a single optimized request.

**Request:**
```bash
curl -H "X-API-Key: your-secret-key" \
     "http://localhost:8080/api/site-data"
```

**Response:**
```json
{
  "site": {
    "title": "My WordPress Site",
    "description": "Just another WordPress site",
    "url": "https://yoursite.com",
    "timezone": "America/New_York",
    "language": "en-US",
    "date_format": "F j, Y",
    "time_format": "g:i a",
    "show_on_front": "page",
    "page_on_front": 5,
    "page_for_posts": 8,
    "posts_per_page": 10,
    "default_category": 1,
    "default_post_format": "0"
  },
  "pages": {
    "homepage": {
      "id": 5,
      "title": "Home",
      "slug": "home",
      "url": "https://yoursite.com/",
      "status": "publish",
      "type": "page"
    },
    "blog_page": {
      "id": 8,
      "title": "Blog",
      "slug": "blog",
      "url": "https://yoursite.com/blog",
      "status": "publish",
      "type": "page"
    },
    "privacy_policy": {
      "id": 3,
      "title": "Privacy Policy",
      "slug": "privacy-policy",
      "url": "https://yoursite.com/privacy-policy",
      "status": "publish",
      "type": "page"
    },
    "_settings": {
      "show_on_front": "page",
      "posts_per_page": 10,
      "default_category": 1
    }
  },
  "_meta": {
    "client": "default",
    "endpoint": "/api/site-data",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

**Why use this endpoint?**
- ✅ **One request instead of two** - Get site info + special pages together
- ✅ **Optimized performance** - Parallel fetching under the hood
- ✅ **Complete data** - Everything you need to build navigation, footers, site maps
- ✅ **Timestamp included** - Track when data was fetched
- ✅ **Multi-client support** - Add `?client=client1` for different sites

**Use Cases:**
- Build complete site navigation in one API call
- Initialize headless CMS with all site data
- Create admin dashboards with full site configuration
- Sync multiple WordPress sites efficiently

---

#### GET /api/special-pages

Get special WordPress pages only (if you don't need full site info).

**Request:**
```bash
curl -H "X-API-Key: your-secret-key" \
     "http://localhost:8080/api/special-pages"
```

**Response:**
```json
{
  "homepage": {
    "id": 5,
    "title": "Home",
    "slug": "home",
    "url": "https://yoursite.com/",
    "status": "publish",
    "type": "page"
  },
  "blog_page": {
    "id": 8,
    "title": "Blog",
    "slug": "blog",
    "url": "https://yoursite.com/blog",
    "status": "publish",
    "type": "page"
  },
  "privacy_policy": {
    "id": 3,
    "title": "Privacy Policy",
    "slug": "privacy-policy",
    "url": "https://yoursite.com/privacy-policy",
    "status": "publish",
    "type": "page"
  },
  "_settings": {
    "show_on_front": "page",
    "posts_per_page": 10,
    "default_category": 1
  },
  "_meta": {
    "client": "default",
    "endpoint": "/api/special-pages"
  }
}
```

**Use Cases:**
- Get homepage ID for navigation menus
- Find blog page for archive links
- Access privacy policy page for footer links
- Build dynamic site maps

---

#### GET /api/site-info

Get comprehensive site settings and configuration.

**Request:**
```bash
curl -H "X-API-Key: your-secret-key" \
     "http://localhost:8080/api/site-info"
```

**Response:**
```json
{
  "title": "My WordPress Site",
  "description": "Just another WordPress site",
  "url": "https://yoursite.com",
  "timezone": "America/New_York",
  "language": "en-US",
  "date_format": "F j, Y",
  "time_format": "g:i a",
  "show_on_front": "page",
  "page_on_front": 5,
  "page_for_posts": 8,
  "posts_per_page": 10,
  "default_category": 1,
  "default_post_format": "0",
  "_meta": {
    "client": "default",
    "endpoint": "/api/site-info"
  }
}
```

**Key Fields:**
- `show_on_front`: `"page"` (static homepage) or `"posts"` (blog listing)
- `page_on_front`: Homepage page ID (0 if `show_on_front` is `"posts"`)
- `page_for_posts`: Blog listing page ID
- `posts_per_page`: Number of posts per page
- `default_category`: Default category ID for new posts

**Use Cases:**
- Detect homepage type (static vs. blog)
- Get pagination settings
- Build site configuration dashboards
- Sync site settings across platforms

---

#### Multi-Client Support

All HTTP endpoints support the `?client=` parameter:

```bash
# Get special pages from client1
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/special-pages?client=client1"

# Get site info from client2
curl -H "X-API-Key: abc123" \
     "http://localhost:8080/api/site-info?client=client2"
```

### 🤖 Automatic Client Detection

**The killer feature:** When you provide a full URL, the system automatically detects which WordPress site to query!

#### How Auto-Detection Works:

1. You send a request with a full URL: `?url=https://site1.com/about`
2. System extracts the domain: `site1.com`
3. Compares domain against all configured clients:
   - `WP_API_URL` (default)
   - `CLIENT1_WP_API_URL`
   - `CLIENT2_WP_API_URL`
   - etc.
4. Finds a match and uses those credentials automatically!

#### Example Configuration:

```bash
# .env file
WP_API_URL=https://mainsite.com
CLIENT1_WP_API_URL=https://blog.example.com
CLIENT2_WP_API_URL=https://shop.example.com
```

Now you can query any site without specifying the client:

```bash
# Automatically uses default credentials
GET /api/find?url=https://mainsite.com/privacy

# Automatically uses CLIENT1 credentials
GET /api/find?url=https://blog.example.com/my-post

# Automatically uses CLIENT2 credentials
GET /api/find?url=https://shop.example.com/product-page
```

**No `&client=` parameter needed!** ✨

#### Manual Override

You can still manually specify a client if needed:

```bash
# Force specific client (ignores auto-detection)
GET /api/find?url=https://anywhere.com/page&client=client3
```

### How Search Works

1. **Auto-Detects Client** (if URL provided and no manual client)
2. **Searches Posts First** - Checks all published posts for matching slug
3. **Then Searches Pages** - If not found in posts, checks pages
4. **Returns First Match** - Returns immediately when content is found
5. **Type Indicator** - Response includes `"type": "post"` or `"type": "page"`
6. **Meta Information** - Response includes `_meta.autoDetected: true/false`

### Security

The HTTP API uses a shared API key for authentication:

1. Set `API_KEY` in your `.env` file
2. Send the key in request headers as `X-API-Key` or `Authorization: Bearer <key>`
3. Without API key: requests will be rejected with 401 Unauthorized

```bash
# Generate a secure API key
openssl rand -hex 32
```

Add to `.env`:
```bash
API_KEY=your-generated-key-here
```

---

## 🔧 Installation

No changes to installation process - same as before:

```bash
# Clone the repo
git clone https://github.com/Davidi18/wordpress-mcp.git
cd wordpress-mcp

# Set up environment
cp .env.example .env
# Edit .env with your WordPress credentials

# Run
npm start
```

---

## 🌟 Why This Update Matters

1. **Complete Content Management** - Full CRUD operations on all WordPress content types
2. **Media Workflow** - Now you can update media metadata without re-uploading
3. **Comment Moderation** - Manage comments programmatically
4. **User Management** - Query and manage WordPress users
5. **Taxonomy Control** - Create and organize categories/tags dynamically
6. **Site Intelligence** - Get site configuration and post type information

---

## 🎯 Perfect For

- 🤖 AI-powered content management systems
- 📱 Headless WordPress implementations
- 🔄 Content synchronization tools
- 📊 WordPress data analytics
- 🛠️ Automation workflows
- 🔌 Third-party integrations

---

## 📝 Changelog

### v3.0.0 (Latest)

#### Added
- 🎯 **Strudel Schema Plugin** - Bundled WordPress plugin for JSON-LD management
  - Per-page schema control with metabox UI
  - Global Organization and WebSite schema settings
  - Automatic Yoast/Rank Math override when enabled
  - REST API for remote management
- 📋 **4 New MCP Tools for Schema Management**:
  - `wp_get_schema` - Get schema configuration for any page/post
  - `wp_set_schema` - Set schema using templates or custom JSON-LD
  - `wp_list_schemas` - List all pages with schema configured
  - `wp_preview_schema` - Preview rendered schema without saving
- 🎨 **8 Schema Templates**: service, about, blog, faq, course, local, product, custom
- 🔄 **Override Mode** - Automatically disables competing schema plugins

#### Improved
- Total MCP tools increased to 40+
- Better multi-site schema management
- Simplified plugin UI (override is now default)

### v2.2.0

#### Added
- ⭐ **Unified HTTP Endpoint** - New `GET /api/site-data` endpoint (RECOMMENDED)
  - Get site info + special pages in **one optimized call**
  - Parallel fetching for maximum performance
  - Includes timestamp for cache management
- 🔍 **Universal Search** - Enhanced `/api/find` endpoint
  - Search by **ID** (direct lookup - fastest)
  - Search by **slug** (finds posts, pages, special pages)
  - Search by **URL** (auto-detects client from domain)
  - Search by **text** (full-text search)
  - **Automatic special page detection** - homepage, blog, privacy policy
  - Returns `isSpecialPage` and `specialType` for special pages
- 🌐 **HTTP API for Special Pages** - New `GET /api/special-pages` endpoint
- 🌐 **HTTP API for Site Info** - New `GET /api/site-info` endpoint
- 🏠 **Special Pages Retrieval** - New `wp_get_special_pages` MCP tool
- 📄 **Homepage ID Detection** - Automatically get homepage page ID (static or posts)
- 📝 **Blog Page ID Detection** - Get blog listing page ID when using static homepage
- 🔒 **Privacy Policy Page** - Retrieve privacy policy page details
- 📊 **Enhanced Site Info** - `wp_get_site_info` now includes `show_on_front`, `page_on_front`, `page_for_posts`, `posts_per_page`, and more

#### Improved
- HTTP API expanded from 1 endpoint to **4 endpoints**
- Universal search finds **any content type** - posts, pages, special pages
- Reduced API calls: Get everything in one request with `/api/site-data`
- More comprehensive site configuration data via HTTP
- Better handling of special WordPress pages with automatic detection
- Detailed page information with title, slug, URL, and status
- Multi-client support for all HTTP endpoints
- Total MCP tools increased to 36 (100% increase from v1.0!)

### v2.1.0

#### Added
- 🌐 **HTTP GET API** - New `/api/find` endpoint for direct HTTP queries
- 🔍 **Unified Search** - Automatically searches both posts and pages
- 🤖 **Automatic Client Detection** - System auto-detects which WordPress site to query from URL domain
- 🔐 **API Key Authentication** - Secure HTTP endpoint with shared API key
- 🏢 **Multi-Client HTTP Support** - Query different WordPress sites via `client` parameter
- 📖 **Flexible Search Options** - Find by slug, URL, or text search
- 📊 **Response Metadata** - Includes `_meta` object with client info and auto-detection status
- 📚 **Comprehensive Documentation** - Full HTTP API usage examples

#### Improved
- Updated server version to 2.1.0
- Enhanced `.env.example` with API key configuration
- Better multi-client configuration documentation
- Improved startup logging with emoji indicators
- Smart fallback: manual `client` parameter overrides auto-detection

### v2.0.0

#### Added
- Media update and delete endpoints
- Complete comments CRUD system
- User management endpoints
- Category and tag creation/update/delete
- Site information endpoints
- Enhanced error handling
- Better response formatting

#### Improved
- Updated server version to 2.0.0
- Enhanced tool descriptions
- More detailed input schemas
- Better TypeScript compatibility

---

## 🤝 Contributing

Found a bug or want to add more endpoints? PRs are welcome!

## 📄 License

MIT License - see LICENSE file for details

---

## 🙏 Credits

Enhanced by Claude & n8n-MCP tools integration
Original by [@Davidi18](https://github.com/Davidi18)
