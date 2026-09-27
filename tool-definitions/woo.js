// MCP tool definitions — "woo" toolset (see toolsets.js). Handlers live in executeTool.
export default [
  // WOOCOMMERCE PRODUCTS (requires WooCommerce plugin)
  {
    name: 'wc_list_products',
    description: 'List WooCommerce products with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Products per page (max 100)', default: 20 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search term' },
        category: { type: 'number', description: 'Category ID to filter by' },
        status: { type: 'string', description: 'Status: publish, draft, pending, private, any', default: 'any' },
        type: { type: 'string', description: 'Product type: simple, grouped, external, variable' },
        sku: { type: 'string', description: 'Search by SKU' },
        featured: { type: 'boolean', description: 'Filter featured products' },
        on_sale: { type: 'boolean', description: 'Filter products on sale' }
      }
    }
  },
  {
    name: 'wc_get_product',
    description: 'Get a single WooCommerce product by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Product ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wc_create_product',
    description: 'Create a new WooCommerce product',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Product name' },
        type: { type: 'string', description: 'Product type: simple, grouped, external, variable', default: 'simple' },
        status: { type: 'string', description: 'Status: draft, pending, publish, private', default: 'publish' },
        regular_price: { type: 'string', description: 'Regular price' },
        sale_price: { type: 'string', description: 'Sale price' },
        description: { type: 'string', description: 'Full product description' },
        short_description: { type: 'string', description: 'Short description' },
        sku: { type: 'string', description: 'SKU (Stock Keeping Unit)' },
        categories: { type: 'array', description: 'Array of category objects [{id: 1}, {id: 2}]' },
        images: { type: 'array', description: 'Array of image objects [{src: "url"}, {id: 123}]' },
        manage_stock: { type: 'boolean', description: 'Enable stock management' },
        stock_quantity: { type: 'number', description: 'Stock quantity' },
        stock_status: { type: 'string', description: 'Stock status: instock, outofstock, onbackorder' },
        weight: { type: 'string', description: 'Product weight' },
        dimensions: { type: 'object', description: 'Dimensions: {length, width, height}' },
        attributes: { type: 'array', description: 'Product attributes array' },
        meta_data: { type: 'array', description: 'Meta data array [{key, value}]' }
      },
      required: ['name']
    }
  },
  {
    name: 'wc_update_product',
    description: 'Update an existing WooCommerce product',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Product ID' },
        name: { type: 'string', description: 'Product name' },
        status: { type: 'string', description: 'Status: draft, pending, publish, private' },
        regular_price: { type: 'string', description: 'Regular price' },
        sale_price: { type: 'string', description: 'Sale price' },
        description: { type: 'string', description: 'Full product description' },
        short_description: { type: 'string', description: 'Short description' },
        sku: { type: 'string', description: 'SKU' },
        categories: { type: 'array', description: 'Array of category objects [{id: 1}]' },
        images: { type: 'array', description: 'Array of image objects [{src: "url"}, {id: 123}]' },
        manage_stock: { type: 'boolean', description: 'Enable stock management' },
        stock_quantity: { type: 'number', description: 'Stock quantity' },
        stock_status: { type: 'string', description: 'Stock status: instock, outofstock, onbackorder' },
        featured: { type: 'boolean', description: 'Featured product' },
        meta_data: { type: 'array', description: 'Meta data array [{key, value}]' }
      },
      required: ['id']
    }
  },
  {
    name: 'wc_delete_product',
    description: 'Delete a WooCommerce product',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Product ID' },
        force: { type: 'boolean', description: 'True to permanently delete, false to move to trash', default: false }
      },
      required: ['id']
    }
  },
  // WOOCOMMERCE PRODUCT CATEGORIES
  {
    name: 'wc_list_categories',
    description: 'List WooCommerce product categories',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Categories per page', default: 100 },
        search: { type: 'string', description: 'Search term' },
        parent: { type: 'number', description: 'Parent category ID' },
        hide_empty: { type: 'boolean', description: 'Hide empty categories', default: false }
      }
    }
  },
  {
    name: 'wc_create_category',
    description: 'Create a WooCommerce product category',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category name' },
        slug: { type: 'string', description: 'Category slug' },
        parent: { type: 'number', description: 'Parent category ID' },
        description: { type: 'string', description: 'Category description' },
        image: { type: 'object', description: 'Category image {src: "url"} or {id: 123}' }
      },
      required: ['name']
    }
  },
  {
    name: 'wc_update_category',
    description: 'Update a WooCommerce product category',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID' },
        name: { type: 'string', description: 'Category name' },
        slug: { type: 'string', description: 'Category slug' },
        parent: { type: 'number', description: 'Parent category ID' },
        description: { type: 'string', description: 'Category description' },
        image: { type: 'object', description: 'Category image {src: "url"} or {id: 123}' }
      },
      required: ['id']
    }
  },
  {
    name: 'wc_delete_category',
    description: 'Delete a WooCommerce product category',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID' },
        force: { type: 'boolean', description: 'Force delete (required for categories)', default: true }
      },
      required: ['id']
    }
  },
  // WOOCOMMERCE PRODUCT VARIATIONS (for variable products)
  {
    name: 'wc_list_variations',
    description: 'List variations for a variable product',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'Parent product ID' },
        per_page: { type: 'number', description: 'Variations per page', default: 100 }
      },
      required: ['product_id']
    }
  },
  {
    name: 'wc_create_variation',
    description: 'Create a variation for a variable product',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'Parent product ID' },
        regular_price: { type: 'string', description: 'Regular price' },
        sale_price: { type: 'string', description: 'Sale price' },
        sku: { type: 'string', description: 'SKU' },
        stock_quantity: { type: 'number', description: 'Stock quantity' },
        stock_status: { type: 'string', description: 'Stock status: instock, outofstock, onbackorder' },
        attributes: { type: 'array', description: 'Variation attributes [{name: "Color", option: "Red"}]' },
        image: { type: 'object', description: 'Variation image {src: "url"} or {id: 123}' }
      },
      required: ['product_id', 'attributes']
    }
  },
  {
    name: 'wc_update_variation',
    description: 'Update a product variation',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'Parent product ID' },
        variation_id: { type: 'number', description: 'Variation ID' },
        regular_price: { type: 'string', description: 'Regular price' },
        sale_price: { type: 'string', description: 'Sale price' },
        sku: { type: 'string', description: 'SKU' },
        stock_quantity: { type: 'number', description: 'Stock quantity' },
        stock_status: { type: 'string', description: 'Stock status' },
        image: { type: 'object', description: 'Variation image' }
      },
      required: ['product_id', 'variation_id']
    }
  },
  {
    name: 'wc_delete_variation',
    description: 'Delete a product variation',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'Parent product ID' },
        variation_id: { type: 'number', description: 'Variation ID' },
        force: { type: 'boolean', description: 'Force permanent delete', default: true }
      },
      required: ['product_id', 'variation_id']
    }
  },
  // WOOCOMMERCE ORDERS
  {
    name: 'wc_list_orders',
    description: 'List WooCommerce orders',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Orders per page', default: 20 },
        page: { type: 'number', description: 'Page number', default: 1 },
        status: { type: 'string', description: 'Status: pending, processing, on-hold, completed, cancelled, refunded, failed, any' },
        customer: { type: 'number', description: 'Customer ID' },
        product: { type: 'number', description: 'Product ID to filter by' },
        after: { type: 'string', description: 'Orders after date (ISO8601)' },
        before: { type: 'string', description: 'Orders before date (ISO8601)' }
      }
    }
  },
  {
    name: 'wc_get_order',
    description: 'Get a single WooCommerce order',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Order ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wc_update_order',
    description: 'Update a WooCommerce order (status, notes, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Order ID' },
        status: { type: 'string', description: 'Order status' },
        customer_note: { type: 'string', description: 'Note for customer' },
        meta_data: { type: 'array', description: 'Meta data array [{key, value}]' }
      },
      required: ['id']
    }
  }
];
