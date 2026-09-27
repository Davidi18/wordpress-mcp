// handlers/woo.js
// Tool handlers for the "woo" toolset (see toolsets.js / tool-definitions/woo.js).
// Returns NOT_HANDLED for tool names this toolset doesn't own.
import { NOT_HANDLED } from './not-handled.js';

export async function handleWoo(name, args, ctx) {
  const { wpReq } = ctx;
  switch (name) {

    // WOOCOMMERCE PRODUCTS
    case 'wc_list_products': {
      const params = new URLSearchParams();
      if (args.per_page) params.append('per_page', String(args.per_page));
      if (args.page) params.append('page', String(args.page));
      if (args.search) params.append('search', args.search);
      if (args.category) params.append('category', String(args.category));
      if (args.status) params.append('status', args.status);
      if (args.type) params.append('type', args.type);
      if (args.sku) params.append('sku', args.sku);
      if (args.featured !== undefined) params.append('featured', String(args.featured));
      if (args.on_sale !== undefined) params.append('on_sale', String(args.on_sale));

      const queryString = params.toString();
      const products = await wpReq(`/wc/v3/products${queryString ? '?' + queryString : ''}`);
      return {
        products: products.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          type: p.type,
          status: p.status,
          sku: p.sku,
          price: p.price,
          regular_price: p.regular_price,
          sale_price: p.sale_price,
          stock_status: p.stock_status,
          stock_quantity: p.stock_quantity,
          categories: p.categories,
          images: p.images?.map(img => ({ id: img.id, src: img.src, alt: img.alt })),
          permalink: p.permalink
        })),
        count: products.length
      };
    }


    case 'wc_get_product': {
      const product = await wpReq(`/wc/v3/products/${args.id}`);
      return product;
    }


    case 'wc_create_product': {
      const payload = { name: args.name };
      if (args.type) payload.type = args.type;
      if (args.status) payload.status = args.status;
      if (args.regular_price) payload.regular_price = args.regular_price;
      if (args.sale_price) payload.sale_price = args.sale_price;
      if (args.description) payload.description = args.description;
      if (args.short_description) payload.short_description = args.short_description;
      if (args.sku) payload.sku = args.sku;
      if (args.categories) payload.categories = args.categories;
      if (args.images) payload.images = args.images;
      if (args.manage_stock !== undefined) payload.manage_stock = args.manage_stock;
      if (args.stock_quantity !== undefined) payload.stock_quantity = args.stock_quantity;
      if (args.stock_status) payload.stock_status = args.stock_status;
      if (args.weight) payload.weight = args.weight;
      if (args.dimensions) payload.dimensions = args.dimensions;
      if (args.attributes) payload.attributes = args.attributes;
      if (args.meta_data) payload.meta_data = args.meta_data;

      const product = await wpReq('/wc/v3/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          permalink: product.permalink,
          status: product.status,
          type: product.type
        }
      };
    }


    case 'wc_update_product': {
      const payload = {};
      if (args.name !== undefined) payload.name = args.name;
      if (args.status !== undefined) payload.status = args.status;
      if (args.regular_price !== undefined) payload.regular_price = args.regular_price;
      if (args.sale_price !== undefined) payload.sale_price = args.sale_price;
      if (args.description !== undefined) payload.description = args.description;
      if (args.short_description !== undefined) payload.short_description = args.short_description;
      if (args.sku !== undefined) payload.sku = args.sku;
      if (args.categories) payload.categories = args.categories;
      if (args.images) payload.images = args.images;
      if (args.manage_stock !== undefined) payload.manage_stock = args.manage_stock;
      if (args.stock_quantity !== undefined) payload.stock_quantity = args.stock_quantity;
      if (args.stock_status) payload.stock_status = args.stock_status;
      if (args.featured !== undefined) payload.featured = args.featured;
      if (args.meta_data) payload.meta_data = args.meta_data;

      const product = await wpReq(`/wc/v3/products/${args.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          permalink: product.permalink,
          status: product.status
        }
      };
    }


    case 'wc_delete_product': {
      const params = args.force ? '?force=true' : '';
      const result = await wpReq(`/wc/v3/products/${args.id}${params}`, {
        method: 'DELETE'
      });
      return {
        success: true,
        deleted: result.id,
        message: args.force ? 'Product permanently deleted' : 'Product moved to trash'
      };
    }


    // WOOCOMMERCE CATEGORIES
    case 'wc_list_categories': {
      const params = new URLSearchParams();
      if (args.per_page) params.append('per_page', String(args.per_page));
      if (args.search) params.append('search', args.search);
      if (args.parent !== undefined) params.append('parent', String(args.parent));
      if (args.hide_empty !== undefined) params.append('hide_empty', String(args.hide_empty));

      const queryString = params.toString();
      const categories = await wpReq(`/wc/v3/products/categories${queryString ? '?' + queryString : ''}`);
      return {
        categories: categories.map(c => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          parent: c.parent,
          description: c.description,
          count: c.count,
          image: c.image
        })),
        count: categories.length
      };
    }


    case 'wc_create_category': {
      const payload = { name: args.name };
      if (args.slug) payload.slug = args.slug;
      if (args.parent) payload.parent = args.parent;
      if (args.description) payload.description = args.description;
      if (args.image) payload.image = args.image;

      const category = await wpReq('/wc/v3/products/categories', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          parent: category.parent
        }
      };
    }


    case 'wc_update_category': {
      const payload = {};
      if (args.name !== undefined) payload.name = args.name;
      if (args.slug !== undefined) payload.slug = args.slug;
      if (args.parent !== undefined) payload.parent = args.parent;
      if (args.description !== undefined) payload.description = args.description;
      if (args.image) payload.image = args.image;

      const category = await wpReq(`/wc/v3/products/categories/${args.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug
        }
      };
    }


    case 'wc_delete_category': {
      const params = args.force !== false ? '?force=true' : '';
      const result = await wpReq(`/wc/v3/products/categories/${args.id}${params}`, {
        method: 'DELETE'
      });
      return {
        success: true,
        deleted: result.id,
        message: 'Category deleted'
      };
    }


    // WOOCOMMERCE VARIATIONS
    case 'wc_list_variations': {
      const params = new URLSearchParams();
      if (args.per_page) params.append('per_page', String(args.per_page));

      const queryString = params.toString();
      const variations = await wpReq(`/wc/v3/products/${args.product_id}/variations${queryString ? '?' + queryString : ''}`);
      return {
        product_id: args.product_id,
        variations: variations.map(v => ({
          id: v.id,
          sku: v.sku,
          price: v.price,
          regular_price: v.regular_price,
          sale_price: v.sale_price,
          stock_status: v.stock_status,
          stock_quantity: v.stock_quantity,
          attributes: v.attributes,
          image: v.image
        })),
        count: variations.length
      };
    }


    case 'wc_create_variation': {
      const payload = {};
      if (args.regular_price) payload.regular_price = args.regular_price;
      if (args.sale_price) payload.sale_price = args.sale_price;
      if (args.sku) payload.sku = args.sku;
      if (args.stock_quantity !== undefined) payload.stock_quantity = args.stock_quantity;
      if (args.stock_status) payload.stock_status = args.stock_status;
      if (args.attributes) payload.attributes = args.attributes;
      if (args.image) payload.image = args.image;

      const variation = await wpReq(`/wc/v3/products/${args.product_id}/variations`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        variation: {
          id: variation.id,
          sku: variation.sku,
          price: variation.price,
          attributes: variation.attributes
        }
      };
    }


    case 'wc_update_variation': {
      const payload = {};
      if (args.regular_price !== undefined) payload.regular_price = args.regular_price;
      if (args.sale_price !== undefined) payload.sale_price = args.sale_price;
      if (args.sku !== undefined) payload.sku = args.sku;
      if (args.stock_quantity !== undefined) payload.stock_quantity = args.stock_quantity;
      if (args.stock_status) payload.stock_status = args.stock_status;
      if (args.image) payload.image = args.image;

      const variation = await wpReq(`/wc/v3/products/${args.product_id}/variations/${args.variation_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        variation: {
          id: variation.id,
          sku: variation.sku,
          price: variation.price
        }
      };
    }


    case 'wc_delete_variation': {
      const params = args.force !== false ? '?force=true' : '';
      const result = await wpReq(`/wc/v3/products/${args.product_id}/variations/${args.variation_id}${params}`, {
        method: 'DELETE'
      });
      return {
        success: true,
        deleted: result.id,
        message: 'Variation deleted'
      };
    }


    // WOOCOMMERCE ORDERS
    case 'wc_list_orders': {
      const params = new URLSearchParams();
      if (args.per_page) params.append('per_page', String(args.per_page));
      if (args.page) params.append('page', String(args.page));
      if (args.status) params.append('status', args.status);
      if (args.customer) params.append('customer', String(args.customer));
      if (args.product) params.append('product', String(args.product));
      if (args.after) params.append('after', args.after);
      if (args.before) params.append('before', args.before);

      const queryString = params.toString();
      const orders = await wpReq(`/wc/v3/orders${queryString ? '?' + queryString : ''}`);
      return {
        orders: orders.map(o => ({
          id: o.id,
          number: o.number,
          status: o.status,
          total: o.total,
          currency: o.currency,
          customer_id: o.customer_id,
          billing: {
            first_name: o.billing?.first_name,
            last_name: o.billing?.last_name,
            email: o.billing?.email
          },
          date_created: o.date_created,
          line_items_count: o.line_items?.length
        })),
        count: orders.length
      };
    }


    case 'wc_get_order': {
      const order = await wpReq(`/wc/v3/orders/${args.id}`);
      return order;
    }


    case 'wc_update_order': {
      const payload = {};
      if (args.status !== undefined) payload.status = args.status;
      if (args.customer_note !== undefined) payload.customer_note = args.customer_note;
      if (args.meta_data !== undefined) payload.meta_data = args.meta_data;

      const order = await wpReq(`/wc/v3/orders/${args.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        order: {
          id: order.id,
          number: order.number,
          status: order.status,
          total: order.total
        }
      };
    }
  }
  return NOT_HANDLED;
}
