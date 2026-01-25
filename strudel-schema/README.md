# Strudel Schema

Simple JSON-LD schema management for WordPress.

## What it does

- Adds a **Schema (JSON-LD)** field to every page/post
- When you paste JSON-LD, it outputs it in the page `<head>`
- Automatically disables Yoast/Rank Math schemas on that page

## Installation

1. Upload `strudel-schema` folder to `wp-content/plugins/`
2. Activate the plugin
3. Edit any page → find "Schema (JSON-LD)" box → paste your schema

## Usage

### In WordPress

Edit any page/post, paste your JSON-LD in the Schema field:

```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "קידום אתרים",
  "provider": {
    "@type": "Organization",
    "name": "Strudel Marketing"
  }
}
```

Save. Done.

### Via MCP

```javascript
wp_set_schema({
  url: "https://site.com/about",
  schema: { "@context": "https://schema.org", "@type": "AboutPage", ... }
})
```

### Via REST API

```
POST /wp-json/strudel-schema/v1/post/123
{ "schema": { ... } }
```

## That's it

No modes, no templates, no complexity. Just paste JSON-LD.
