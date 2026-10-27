<?php
/**
 * Sali di Ischia: partition WooCommerce order reads at the connector cutover.
 * API key 1 keeps historical orders; catalog fields managed by key 3 are protected.
 * API key 3 imports orders and synchronizes list 1 / warehouse 5 to the site.
 * Rollback: disable this snippet and disable the Windows connector task.
 */
defined('ABSPATH') || exit;

function sdi_mexal_partition_rows($rows, $cutoff) {
    return array_values(array_filter($rows, static function ($row) use ($cutoff) {
        return is_array($row) && isset($row['id']) && (int) $row['id'] > 0 && (int) $row['id'] <= $cutoff;
    }));
}

// Self-check the pure partition before registering any live response filter.
if (sdi_mexal_partition_rows(array(array('id' => 13729), array('id' => 13730)), 13729) !== array(array('id' => 13729))) {
    return;
}

add_filter('woocommerce_disable_rest_api_access_log', static function ($skip, $key_id, $user_id) {
    // WooCommerce calls this with the AUTHENTICATED key ID before dispatch.
    // Do not inspect, persist, or log raw keys or Authorization headers.
    $GLOBALS['sdi_mexal_current_api_key_id'] = (int) $key_id;
    return $skip;
}, 10, 3);

add_filter('rest_post_dispatch', static function ($response, $server, $request) {
    if ('GET' !== $request->get_method() || 1 !== (int) ($GLOBALS['sdi_mexal_current_api_key_id'] ?? 0)) {
        return $response;
    }
    $route = $request->get_route();
    if (!preg_match('#^/wc/v[123]/orders(?:/(\d+))?(?:/.*)?$#', $route, $match)) {
        return $response;
    }
    $cutoff = 13729;
    if (!empty($match[1]) && (int) $match[1] > $cutoff) {
        return new WP_REST_Response(array('code' => 'woocommerce_rest_shop_order_invalid_id', 'message' => 'Ordine gestito dal nuovo connettore Mexal.', 'data' => array('status' => 404)), 404);
    }
    if (preg_match('#^/wc/v[123]/orders/?$#', $route) && $response instanceof WP_REST_Response && 200 === $response->get_status()) {
        $data = $response->get_data();
        if (is_array($data)) {
            $filtered = sdi_mexal_partition_rows($data, $cutoff);
            if (count($filtered) !== count($data)) {
                update_option('sdi_mexal_last_legacy_partition', gmdate('c'), false);
            }
            $response->set_data($filtered);
        }
    }
    return $response;
}, 100, 3);

add_action('rest_api_init', static function () {
    register_rest_route('wc-sdi/v1', '/connector-status', array(
        'methods' => 'GET',
        'permission_callback' => static function () { return current_user_can('manage_woocommerce'); },
        'callback' => static function () {
            return new WP_REST_Response(array(
                'version' => 1,
                'catalog_guard_version' => 1,
                'partition_active' => true,
                'legacy_key_id' => 1,
                'connector_key_id' => 3,
                'last_legacy_order_id' => 13729,
                'authenticated_key_id' => (int) ($GLOBALS['sdi_mexal_current_api_key_id'] ?? 0),
                'last_partition_at' => get_option('sdi_mexal_last_legacy_partition', null),
            ), 200);
        },
    ));
});

// Protect the new catalog values from the historical connector's product updates.
// Product descriptions, images, categories and unrelated metadata stay editable.
function sdi_mexal_catalog_guard($product, $request) {
    if (1 !== (int) ($GLOBALS['sdi_mexal_current_api_key_id'] ?? 0) || !$product->get_id()) {
        return $product;
    }
    $stored = wc_get_product($product->get_id());
    $snapshot = $stored ? $stored->get_meta('_sdi_mexal_catalog_v1', true, 'edit') : null;
    if (!is_array($snapshot) || 1 !== (int) ($snapshot['version'] ?? 0) || $stored->get_sku('edit') !== ($snapshot['sku'] ?? null)) {
        return $product;
    }
    $product->set_regular_price($snapshot['price']);
    $product->set_sale_price('');
    $product->set_date_on_sale_from(null);
    $product->set_date_on_sale_to(null);
    $product->set_manage_stock(true);
    $product->set_stock_quantity($snapshot['quantity']);
    $product->set_stock_status($snapshot['status']);
    $product->set_backorders('no');
    $product->update_meta_data('_sdi_mexal_catalog_v1', $snapshot);
    return $product;
}
add_filter('woocommerce_rest_pre_insert_product_object', 'sdi_mexal_catalog_guard', 100, 2);
add_filter('woocommerce_rest_pre_insert_product_variation_object', 'sdi_mexal_catalog_guard', 100, 2);

// A positive stock quantity must not make an item purchasable below the threshold.
function sdi_mexal_catalog_stock_status($status, $product) {
    $snapshot = $product->get_meta('_sdi_mexal_catalog_v1', true, 'edit');
    if (is_array($snapshot) && 1 === (int) ($snapshot['version'] ?? 0)
        && $product->get_sku('edit') === ($snapshot['sku'] ?? null)
        && isset($snapshot['physical']) && (float) $snapshot['physical'] < 10) {
        return 'outofstock';
    }
    return $status;
}
add_filter('woocommerce_product_get_stock_status', 'sdi_mexal_catalog_stock_status', 100, 2);
add_filter('woocommerce_product_variation_get_stock_status', 'sdi_mexal_catalog_stock_status', 100, 2);
