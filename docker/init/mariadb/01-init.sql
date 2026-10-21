-- ==============================================================================
-- DynoDbModeler Sample MariaDB Test Schema
-- ==============================================================================

CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    sku VARCHAR(64) NOT NULL UNIQUE,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mariadb_products_categories
        FOREIGN KEY (category_id)
        REFERENCES categories (category_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
    customer_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(30),
    address TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    order_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    shipping_address TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mariadb_orders_customers
        FOREIGN KEY (customer_id)
        REFERENCES customers (customer_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    CONSTRAINT fk_mariadb_order_items_orders
        FOREIGN KEY (order_id)
        REFERENCES orders (order_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_mariadb_order_items_products
        FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    customer_id INT NOT NULL,
    rating INT NOT NULL,
    comment TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mariadb_reviews_products
        FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_mariadb_reviews_customers
        FOREIGN KEY (customer_id)
        REFERENCES customers (customer_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Initial Test Data
INSERT IGNORE INTO categories (name, slug, description) VALUES
('Laptops & Ultrabooks', 'laptops-ultrabooks', 'High-performance and ultra-portable mobile computing devices'),
('Peripherals', 'peripherals', 'Keyboards, mice, webcams, and desk accessories'),
('Monitors', 'monitors', '4K UHD, HDR, and high-refresh-rate gaming displays');

INSERT IGNORE INTO products (category_id, name, sku, price, stock_quantity, is_active) VALUES
(1, 'ProBook Dev 16X M4', 'NB-PB-16X-M4', 1899.99, 45, TRUE),
(1, 'AirBlade Ultra 14', 'NB-AB-14-SILVER', 1299.00, 80, TRUE),
(2, 'Mechanical Tactile Pro 75%', 'KB-TAC-75-DARK', 149.50, 150, TRUE),
(2, 'Precision Wireless Ergonomic Mouse', 'MS-ERG-WL-BLACK', 89.90, 200, TRUE),
(3, 'UltraWide 34-inch Curve 165Hz', 'MON-UW-34-CRV', 699.00, 30, TRUE);

INSERT IGNORE INTO customers (full_name, email, phone, address) VALUES
('Alice Nguyen', 'alice.nguyen@example.com', '+84901234567', '72 Le Loi, District 1, Ho Chi Minh City'),
('Bob Tran', 'bob.tran@example.com', '+84912345678', '15 Hoang Hoa Tham, Ba Dinh, Ha Noi'),
('Charlie Le', 'charlie.le@example.com', '+84988776655', '88 Tran Phu, Hai Chau, Da Nang');

INSERT IGNORE INTO orders (customer_id, order_status, total_amount, shipping_address) VALUES
(1, 'completed', 2049.49, '72 Le Loi, District 1, Ho Chi Minh City'),
(2, 'processing', 699.00, '15 Hoang Hoa Tham, Ba Dinh, Ha Noi');

INSERT IGNORE INTO order_items (order_id, product_id, quantity, unit_price) VALUES
(1, 1, 1, 1899.99),
(1, 3, 1, 149.50),
(2, 5, 1, 699.00);

INSERT IGNORE INTO product_reviews (product_id, customer_id, rating, comment) VALUES
(1, 1, 5, 'Super smooth compile speed with Rust and Vite! Excellent battery life.'),
(3, 1, 4, 'Crisp mechanical feel, lovely minimalist backlighting.');
