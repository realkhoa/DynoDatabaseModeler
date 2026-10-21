-- ==============================================================================
-- DynoDbModeler Sample PostgreSQL Test Schema
-- ==============================================================================

CREATE TABLE IF NOT EXISTS categories (
    category_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    product_id SERIAL PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    sku VARCHAR(64) NOT NULL UNIQUE,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_products_categories
        FOREIGN KEY (category_id)
        REFERENCES categories (category_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id SERIAL PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(30),
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    order_status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (order_status IN ('pending', 'processing', 'completed', 'cancelled')),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    shipping_address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_customers
        FOREIGN KEY (customer_id)
        REFERENCES customers (customer_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    CONSTRAINT fk_order_items_orders
        FOREIGN KEY (order_id)
        REFERENCES orders (order_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_order_items_products
        FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS product_reviews (
    review_id SERIAL PRIMARY KEY,
    product_id INT NOT NULL,
    customer_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reviews_products
        FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_reviews_customers
        FOREIGN KEY (customer_id)
        REFERENCES customers (customer_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- Seed Initial Test Data
INSERT INTO categories (name, slug, description) VALUES
('Laptops & Ultrabooks', 'laptops-ultrabooks', 'High-performance and ultra-portable mobile computing devices'),
('Peripherals', 'peripherals', 'Keyboards, mice, webcams, and desk accessories'),
('Monitors', 'monitors', '4K UHD, HDR, and high-refresh-rate gaming displays')
ON CONFLICT DO NOTHING;

INSERT INTO products (category_id, name, sku, price, stock_quantity, is_active) VALUES
(1, 'ProBook Dev 16X M4', 'NB-PB-16X-M4', 1899.99, 45, TRUE),
(1, 'AirBlade Ultra 14', 'NB-AB-14-SILVER', 1299.00, 80, TRUE),
(2, 'Mechanical Tactile Pro 75%', 'KB-TAC-75-DARK', 149.50, 150, TRUE),
(2, 'Precision Wireless Ergonomic Mouse', 'MS-ERG-WL-BLACK', 89.90, 200, TRUE),
(3, 'UltraWide 34-inch Curve 165Hz', 'MON-UW-34-CRV', 699.00, 30, TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO customers (full_name, email, phone, address) VALUES
('Alice Nguyen', 'alice.nguyen@example.com', '+84901234567', '72 Le Loi, District 1, Ho Chi Minh City'),
('Bob Tran', 'bob.tran@example.com', '+84912345678', '15 Hoang Hoa Tham, Ba Dinh, Ha Noi'),
('Charlie Le', 'charlie.le@example.com', '+84988776655', '88 Tran Phu, Hai Chau, Da Nang')
ON CONFLICT DO NOTHING;

INSERT INTO orders (customer_id, order_status, total_amount, shipping_address) VALUES
(1, 'completed', 2049.49, '72 Le Loi, District 1, Ho Chi Minh City'),
(2, 'processing', 699.00, '15 Hoang Hoa Tham, Ba Dinh, Ha Noi')
ON CONFLICT DO NOTHING;

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
(1, 1, 1, 1899.99),
(1, 3, 1, 149.50),
(2, 5, 1, 699.00)
ON CONFLICT DO NOTHING;

INSERT INTO product_reviews (product_id, customer_id, rating, comment) VALUES
(1, 1, 5, 'Super smooth compile speed with Rust and Vite! Excellent battery life.'),
(3, 1, 4, 'Crisp mechanical feel, lovely minimalist backlighting.')
ON CONFLICT DO NOTHING;
