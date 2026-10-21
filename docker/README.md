# DynoDbModeler Multi-Database Test Environment

This module provides a containerized suite of relational and NoSQL databases configured specifically for testing and developing **DynoDbModeler**. It enables immediate testing of catalog introspection, schema entity-relationship (ERD) visualization, DDL diff generation, migrations, and live SQL query execution.

---

## 1. Overview & Purpose

DynoDbModeler supports native drivers for multiple database dialects:
- **PostgreSQL** (via `sqlx`)
- **MySQL & MariaDB** (via `sqlx`)
- **Microsoft SQL Server (MSSQL)** (via `tiberius`)
- **MongoDB** & **Redis** (complementary application test stores)
- **Adminer** (web-based visual administration fallback)

This Docker Compose setup spins up isolated, production-grade container instances of all supported database engines, pre-configured with rich e-commerce sample schemas (including primary keys, foreign keys with cascade rules, check constraints, unique indexes, and seed records).

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        DynoDbModeler Desktop App                       │
└────────────┬───────────────┬────────────────┬─────────────────┬────────┘
             │ :5433         │ :3306          │ :3307           │ :1433
             ▼               ▼                ▼                 ▼
      ┌────────────┐   ┌───────────┐   ┌────────────┐   ┌───────────────┐
      │ PostgreSQL │   │   MySQL   │   │  MariaDB   │   │  SQL Server   │
      │   v16      │   │   v8.4    │   │   v11.4    │   │    v2022      │
      └────────────┘   └───────────┘   └────────────┘   └───────▲───────┘
                                                                │
                                                        ┌───────┴───────┐
                                                        │  mssql-init   │
                                                        │ (Auto-seeder) │
                                                        └───────────────┘
```

---

## 2. Prerequisites & Dependencies

- **Docker Desktop** (version 24.0+ or later with Compose v2.20+)
- **WSL 2 Backend** enabled on Windows
- Minimum system resources:
  - **RAM**: 4 GB free memory (MSSQL requires ~2 GB minimum)
  - **Disk**: 10 GB free space for database images and volume caches
- **PowerShell 7+** or Windows PowerShell 5.1

---

## 3. Database Endpoints & Credentials Reference

All parameters can be customized via `.env` in the project root.

| Engine | Container Name | Host Port | Internal Port | Database | Username | Password |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL** | `dyno-postgres` | `5433` *(Note 1)* | `5432` | `dyno_test` | `dyno_user` | `dyno_password_123` |
| **MySQL** | `dyno-mysql` | `3306` | `3306` | `dyno_test` | `dyno_user` / `root` | `dyno_password_123` / `dyno_root_password_123` |
| **MariaDB** | `dyno-mariadb` | `3307` | `3306` | `dyno_test` | `dyno_user` / `root` | `dyno_password_123` / `dyno_root_password_123` |
| **MSSQL 2022** | `dyno-mssql` | `1433` | `1433` | `dyno_test` | `sa` | `DynoPassword123!` *(Note 2)* |
| **MongoDB** | `dyno-mongo` | `27017` | `27017` | `dyno_test` | `dyno_user` | `dyno_password_123` |
| **Redis** | `dyno-redis` | `6379` | `6379` | `0` | - | `dyno_password_123` |
| **Adminer** | `dyno-adminer` | `8080` | `8080` | Web UI | - | Connects to any above |

> **Note 1**: PostgreSQL host port is set to `5433` by default to avoid conflicts with existing local services occupying port `5432`. If port `5432` is free on your machine, you can change `POSTGRES_PORT=5432` in `.env`.
>
> **Note 2**: Microsoft SQL Server strictly enforces password complexity. Changing `MSSQL_SA_PASSWORD` requires at least 8 characters, containing uppercase, lowercase, numbers, and symbols.

---

## 4. CLI Options & Management Scripts

A PowerShell helper script is provided at `docker/manage.ps1`:

| Command | Action Description |
| :--- | :--- |
| `.\docker\manage.ps1 start` | Starts all database containers in detached mode (`docker compose up -d`) |
| `.\docker\manage.ps1 start <service>` | Starts a single database service (e.g. `postgres`, `mysql`, `mssql`) |
| `.\docker\manage.ps1 stop` | Gracefully stops all database containers |
| `.\docker\manage.ps1 restart` | Restarts all database containers |
| `.\docker\manage.ps1 status` | Prints health status and port bindings of all containers |
| `.\docker\manage.ps1 logs [service]` | Streams real-time container output logs |
| `.\docker\manage.ps1 reset` | Drops containers, purges data volumes, and rebuilds fresh seeded databases |
| `.\docker\manage.ps1 help` | Displays interactive usage instructions |

---

## 5. Usage Examples

### 5.1 Starting All Databases
```powershell
# Using the helper script
.\docker\manage.ps1 start

# Or using docker compose directly
docker compose up -d
```

### 5.2 Starting Only Specific Engines
To conserve RAM and CPU, start only the engines you need for current development:
```powershell
# Only PostgreSQL and MySQL
docker compose up -d postgres mysql

# Only SQL Server and its auto-seeder
docker compose up -d mssql mssql-init
```

### 5.3 Connecting DynoDbModeler

Open **DynoDbModeler**, click **Add Connection**, and fill in the values:

#### PostgreSQL
- **Engine**: `PostgreSQL`
- **Host**: `127.0.0.1`
- **Port**: `5433`
- **Database**: `dyno_test`
- **User**: `dyno_user`
- **Password**: `dyno_password_123`

#### MySQL
- **Engine**: `MySQL`
- **Host**: `127.0.0.1`
- **Port**: `3306`
- **Database**: `dyno_test`
- **User**: `dyno_user`
- **Password**: `dyno_password_123`

#### Microsoft SQL Server
- **Engine**: `Microsoft SQL Server`
- **Host**: `127.0.0.1`
- **Port**: `1433`
- **Database**: `dyno_test`
- **User**: `sa`
- **Password**: `DynoPassword123!`

---

## 6. Pre-Seeded Schema Structure

Each relational database is automatically seeded with an interconnected e-commerce schema:

```text
categories (1) ──< products (N) ──< order_items (N) >── orders (1) ──< customers (1)
                        │
                        └──< product_reviews (N) >── customers (1)
```

- `categories`: Product classifications with slug indexing.
- `products`: Product catalog with FK references to `categories`.
- `customers`: Customer directory with email uniqueness.
- `orders`: Transactions linked to `customers`.
- `order_items`: Line items linking `orders` and `products`.
- `product_reviews`: Customer reviews linking `products` and `customers`.

---

## 7. Troubleshooting & Edge Cases

### Port Already Allocated (`bind: address already in use`)
If a port is already taken by another service on your machine:
1. Identify which service is using the port:
   ```powershell
   Get-NetTCPConnection -LocalPort <port>
   ```
2. Adjust the corresponding port mapping in `.env`:
   ```env
   POSTGRES_PORT=5434
   MYSQL_PORT=3308
   MSSQL_PORT=1434
   ```
3. Restart containers with `docker compose up -d`.

### MSSQL Initialization Delay
SQL Server 2022 takes 10-20 seconds to perform its initial setup. The `mssql-init` container waits for the `mssql` container's healthcheck to pass before running the seeder script. You can track progress with:
```powershell
docker compose logs -f mssql-init
```

### Resetting Dirty Test Data
If test runs or DDL migrations leave the schema in an altered state:
```powershell
.\docker\manage.ps1 reset
```
This drops the named volumes and runs the initial seed SQL files again.
