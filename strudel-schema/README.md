# Strudel Schema

WordPress plugin for managing JSON-LD schema markup with full API control.

## Installation

1. Download `strudel-schema.zip`
2. WordPress Admin → Plugins → Add New → Upload Plugin
3. Activate the plugin

## Quick Start

### 1. Global Settings

Go to **Settings → Strudel Schema** and fill in:

- **Organization**: Business name, URL, logo, phone, email, social profiles
- **WebSite**: Site name, description, language

### 2. Per-Page Schema

Edit any page/post and find the **"Strudel Schema"** metabox:

1. Select a **Template** (Service, AboutPage, FAQ, etc.)
2. Fill in the **Template Data** JSON
3. Save the page

That's it. The schema will be output in the page's `<head>`.

## Templates

| Template | Template Data Fields |
|----------|---------------------|
| `service` | `service_name`, `service_description`, `area_served`, `service_type` |
| `about` | `organization_id` (auto-filled from global settings) |
| `blog` | `organization_id` (for publisher) |
| `faq` | `faqs` (array of `{question, answer}`) |
| `course` | `course_name`, `course_description`, `course_code`, `start_date`, `end_date` |
| `local` | `business_type`, `business_name`, `telephone`, `address`, `latitude`, `longitude` |
| `product` | `product_name`, `sku`, `brand`, `price`, `currency`, `availability` |
| `custom` | Use `override_json` for complete control |

## REST API

### Get page schema config
```
GET /wp-json/strudel-schema/v1/post/{id}
```

### Update page schema
```
POST /wp-json/strudel-schema/v1/post/{id}
{
  "mode": "override",
  "template": "service",
  "data_json": {
    "service_name": "SEO Services",
    "area_served": "IL"
  }
}
```

### Preview without saving
```
POST /wp-json/strudel-schema/v1/post/{id}/preview
```

### Get rendered schema
```
GET /wp-json/strudel-schema/v1/post/{id}/rendered
```

### Batch update
```
POST /wp-json/strudel-schema/v1/batch
{
  "posts": [
    { "id": 10, "template": "service", "data_json": {...} },
    { "id": 15, "template": "about" }
  ]
}
```

### List pages with schema
```
GET /wp-json/strudel-schema/v1/posts?template=service&per_page=50
```

## Examples

### Service Page
```json
{
  "mode": "override",
  "template": "service",
  "data_json": {
    "service_name": "קידום אתרים",
    "service_description": "שירותי SEO מקצועיים לעסקים",
    "area_served": "IL",
    "service_type": "SEO"
  }
}
```

### FAQ Page
```json
{
  "mode": "override",
  "template": "faq",
  "data_json": {
    "faqs": [
      {
        "question": "כמה עולה קידום אתרים?",
        "answer": "המחיר תלוי בהיקף הפרויקט..."
      },
      {
        "question": "כמה זמן לוקח לראות תוצאות?",
        "answer": "בדרך כלל 3-6 חודשים..."
      }
    ]
  }
}
```

### Custom Schema (Full Override)
```json
{
  "mode": "override",
  "template": "custom",
  "override_json": {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": "https://example.com/page/#webpage",
        "name": "Page Title",
        "description": "Page description"
      }
    ]
  }
}
```

## Yoast / Rank Math

When a page is set to **Override** mode, Strudel Schema automatically disables JSON-LD output from Yoast SEO and Rank Math on that page.

## Authentication

The API requires WordPress authentication with `edit_post` capability. Use:
- Application Passwords (recommended)
- JWT
- Cookie authentication

## Version

0.1.0
