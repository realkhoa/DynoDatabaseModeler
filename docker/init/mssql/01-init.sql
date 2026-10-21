-- ==============================================================================
-- DynoDbModeler Sample Microsoft SQL Server Test Schema
-- ==============================================================================

IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'dyno_test')
BEGIN
    CREATE DATABASE dyno_test;
END
GO

USE dyno_test;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'categories')
BEGIN
    CREATE TABLE categories (
        category_id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL UNIQUE,
        slug NVARCHAR(120) NOT NULL UNIQUE,
        description NVARCHAR(MAX),
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'products')
BEGIN
    CREATE TABLE products (
        product_id INT IDENTITY(1,1) PRIMARY KEY,
        category_id INT NOT NULL,
        name NVARCHAR(150) NOT NULL,
        sku NVARCHAR(64) NOT NULL UNIQUE,
        price DECIMAL(10, 2) NOT NULL,
        stock_quantity INT NOT NULL DEFAULT 0,
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_mssql_products_categories
            FOREIGN KEY (category_id)
            REFERENCES categories (category_id)
            ON UPDATE CASCADE
            ON DELETE NO ACTION
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'customers')
BEGIN
    CREATE TABLE customers (
        customer_id INT IDENTITY(1,1) PRIMARY KEY,
        full_name NVARCHAR(120) NOT NULL,
        email NVARCHAR(150) NOT NULL UNIQUE,
        phone NVARCHAR(30),
        address NVARCHAR(MAX),
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'orders')
BEGIN
    CREATE TABLE orders (
        order_id INT IDENTITY(1,1) PRIMARY KEY,
        customer_id INT NOT NULL,
        order_status NVARCHAR(30) NOT NULL DEFAULT 'pending',
        total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        shipping_address NVARCHAR(MAX) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_mssql_orders_customers
            FOREIGN KEY (customer_id)
            REFERENCES customers (customer_id)
            ON UPDATE CASCADE
            ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'order_items')
BEGIN
    CREATE TABLE order_items (
        order_item_id INT IDENTITY(1,1) PRIMARY KEY,
        order_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity INT NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        CONSTRAINT fk_mssql_order_items_orders
            FOREIGN KEY (order_id)
            REFERENCES orders (order_id)
            ON UPDATE CASCADE
            ON DELETE CASCADE,
        CONSTRAINT fk_mssql_order_items_products
            FOREIGN KEY (product_id)
            REFERENCES products (product_id)
            ON UPDATE NO ACTION
            ON DELETE NO ACTION
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'product_reviews')
BEGIN
    CREATE TABLE product_reviews (
        review_id INT IDENTITY(1,1) PRIMARY KEY,
        product_id INT NOT NULL,
        customer_id INT NOT NULL,
        rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment NVARCHAR(MAX),
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_mssql_reviews_products
            FOREIGN KEY (product_id)
            REFERENCES products (product_id)
            ON UPDATE CASCADE
            ON DELETE CASCADE,
        CONSTRAINT fk_mssql_reviews_customers
            FOREIGN KEY (customer_id)
            REFERENCES customers (customer_id)
            ON UPDATE NO ACTION
            ON DELETE NO ACTION
    );
END
GO

-- Seed Initial Test Data
IF NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'laptops-ultrabooks')
BEGIN
    INSERT INTO categories (name, slug, description) VALUES
    ('Laptops & Ultrabooks', 'laptops-ultrabooks', 'High-performance and ultra-portable mobile computing devices'),
    ('Peripherals', 'peripherals', 'Keyboards, mice, webcams, and desk accessories'),
    ('Monitors', 'monitors', '4K UHD, HDR, and high-refresh-rate gaming displays');
END
GO

IF NOT EXISTS (SELECT 1 FROM products WHERE sku = 'NB-PB-16X-M4')
BEGIN
    INSERT INTO products (category_id, name, sku, price, stock_quantity, is_active) VALUES
    (1, 'ProBook Dev 16X M4', 'NB-PB-16X-M4', 1899.99, 45, 1),
    (1, 'AirBlade Ultra 14', 'NB-AB-14-SILVER', 1299.00, 80, 1),
    (2, 'Mechanical Tactile Pro 75%', 'KB-TAC-75-DARK', 149.50, 150, 1),
    (2, 'Precision Wireless Ergonomic Mouse', 'MS-ERG-WL-BLACK', 89.90, 200, 1),
    (3, 'UltraWide 34-inch Curve 165Hz', 'MON-UW-34-CRV', 699.00, 30, 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM customers WHERE email = 'alice.nguyen@example.com')
BEGIN
    INSERT INTO customers (full_name, email, phone, address) VALUES
    ('Alice Nguyen', 'alice.nguyen@example.com', '+84901234567', '72 Le Loi, District 1, Ho Chi Minh City'),
    ('Bob Tran', 'bob.tran@example.com', '+84912345678', '15 Hoang Hoa Tham, Ba Dinh, Ha Noi'),
    ('Charlie Le', 'charlie.le@example.com', '+84988776655', '88 Tran Phu, Hai Chau, Da Nang');
END
GO

IF NOT EXISTS (SELECT 1 FROM orders WHERE customer_id = 1)
BEGIN
    INSERT INTO orders (customer_id, order_status, total_amount, shipping_address) VALUES
    (1, 'completed', 2049.49, '72 Le Loi, District 1, Ho Chi Minh City'),
    (2, 'processing', 699.00, '15 Hoang Hoa Tham, Ba Dinh, Ha Noi');

    INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    (1, 1, 1, 1899.99),
    (1, 3, 1, 149.50),
    (2, 5, 1, 699.00);

    INSERT INTO product_reviews (product_id, customer_id, rating, comment) VALUES
    (1, 1, 5, 'Super smooth compile speed with Rust and Vite! Excellent battery life.'),
    (3, 1, 4, 'Crisp mechanical feel, lovely minimalist backlighting.');
END
GO
