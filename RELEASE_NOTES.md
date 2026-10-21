# DynoDbModeler v0.4.0 Release Notes

### 🚀 Next-Gen Tooling Suite Release

DynoDbModeler v0.4.0 delivers three major capabilities elevating DynoDbModeler into a full-featured, developer-first database engineering suite:

---

#### 1. Multi-Language ORM & Entity Code Generator
Compile introspected or visually modeled database schemas directly into production-grade ORM and entity definitions across 7 popular languages and frameworks:
- **Prisma Schema** (`schema.prisma`): Models, primary keys, autoincrement sequence, `@map()`, `@relation()`, and referential actions.
- **Drizzle ORM** (`schema.ts`): Dual dialect support for PostgreSQL (`pgTable`) and SQLite (`sqliteTable`).
- **Golang GORM** (`models.go`): Idiomatic Go structs with camelCase JSON tags and strict `gorm` field annotations.
- **Rust SeaORM** (`entities.rs`): Async Rust entities with `DeriveEntityModel`, `DeriveRelation`, `ActiveModelBehavior`, and `belongs_to` foreign key relations.
- **C# Entity Framework Core** (`Entities.cs`): Microsoft EF Core entity classes decorated with `[Table]`, `[Key]`, `[Column]`, `[ForeignKey]`, and `[DatabaseGenerated]`.
- **Python SQLAlchemy 2.0** (`models.py`): Modern typed declarative models utilizing `Mapped[T]`, `mapped_column`, and `relationship()`.
- **TypeScript TypeORM** (`entities.ts`): NestJS/Node.js decorator-driven entity classes with `@Entity`, `@PrimaryGeneratedColumn`, `@Column`, `@ManyToOne`, and `@JoinColumn`.
- **Developer Experience**: Real-time syntax-highlighted Monaco preview, scope switching (`All Tables` vs. single table), clipboard copy, and direct file download.

---

#### 2. Smart CSV & JSON Data Import Wizard
Seamlessly load tabular datasets into any database engine with a visual 4-step wizard:
- **RFC 4180 CSV & Multiline Support**: Accurately parses escaped double quotes, inner commas, and multiline string cells with automatic delimiter detection (`,`, `;`, `\t`, `|`).
- **JSON Objects Array Import**: Validates and maps arbitrary JSON array payloads.
- **Heuristic Column Auto-Mapping**: Automatically pairs file headers with target database columns using exact matching, case-insensitive normalization, and snake_case vs camelCase heuristics.
- **Dialect-Aware Chunked Batch SQL Engine**: Generates 500-row batch `INSERT` chunks with dialect conflict handling (`ignore`, `replace`, `abort`):
  - PostgreSQL: `ON CONFLICT DO NOTHING / UPDATE`
  - MySQL / MariaDB: `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE`
  - SQLite: `INSERT OR IGNORE / REPLACE`
  - MSSQL / Oracle / DuckDB: Standard batched multi-row inserts.

---

#### 3. Autonomous Database Schema Health Advisor & Linter
Identify architectural bottlenecks, referential risks, and performance smells before deploying migrations to production:
- **8 Heuristic Rules Engine**:
  1. **Missing Primary Key** (Critical): Detects tables without unique row identity and generates `ADD PRIMARY KEY` or identity column SQL.
  2. **Unindexed Foreign Keys** (Warning): Catches unindexed foreign keys that cause full table scans and lock contention during JOINs and parent deletes, generating `CREATE INDEX` SQL.
  3. **Redundant & Duplicate Indexes** (Warning): Pinpoints redundant leading-prefix indexes already covered by composite indexes, generating `DROP INDEX` SQL.
  4. **Reserved SQL Keywords** (Warning): Flags unquoted keyword collisions (`order`, `user`, `group`, `table`).
  5. **Unconstrained Relational Keys** (Info): Identifies apparent relational columns (`*_id`) lacking foreign key constraints.
  6. **Approximate Float for Monetary Values** (Warning): Detects financial amounts stored as `Float`/`Double` and generates `DECIMAL(12, 2)` migration statements.
  7. **Mixed Table Naming Conventions** (Info): Detects inconsistent mixtures of snake_case and camelCase.
- **Dynamic Scoring (0–100%)**: Color-coded score circle with `Excellent`, `Good`, `Fair`, and `Poor` grades.
- **1-Click Remediation**: Execute fixes directly on connected databases, copy single statements, or bundle all safe fixes into a single transaction script (`BEGIN ... COMMIT`) opened in the SQL query worksheet.

---

### 📦 Verification & Quality Evidence
- **Frontend Test Suite**: **507 / 507** unit tests passed across 46 test suites (`bun run test`).
- **Static Code Review**: Clean deterministic review via `knowledge_code_review` with **0 errors and 0 warnings**.
- **Production Build**: Verified clean `tsc && vite build` in 47 seconds with exit code 0.
- **CI/CD Automation**: GitHub Actions multi-platform release matrix automatically packages Windows (`.exe` NSIS, `.msi`), macOS (`.dmg`), and Linux (`.AppImage`, `.deb`) packages upon tag push.
