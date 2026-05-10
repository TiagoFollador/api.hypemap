# Prisma & Migrations

## Por que usamos raw SQL além do Prisma?

O Prisma não suporta tipos nativos do PostGIS (`geometry`, `geography`) como colunas gerenciadas. Por isso, a estratégia é híbrida:

| Tabela | Gerenciada por | Razão |
|---|---|---|
| `app_user` | Prisma | Tabela relacional simples |
| `live_location` (colunas base) | Prisma | `user_id`, `accuracy_m`, `updated_at` |
| `live_location` (colunas espaciais) | `001_init_postgis.sql` | `geom geometry(Point,4326)`, `geog geography(Point,4326)` |
| `location_event` | `002_location_event.sql` | Tabela particionada — Prisma não suporta `PARTITION BY RANGE` |
| `heatmap_cell_5m` | `002_location_event.sql` | Tabela derivada, rebuilt a cada 2 minutos |
| `friend_edge` | Prisma | Grafo de amizades |
| `consent_log` | Prisma | Audit LGPD |
| `squad`, `squad_member` | Prisma | Grupos de ativação |

## Ordem de setup (primeira vez)

```bash
# 1. Criar tabelas gerenciadas pelo Prisma
npx prisma db push

# 2. Adicionar extensão PostGIS + colunas espaciais em live_location
psql "$DATABASE_URL" -f prisma/migrations/001_init_postgis.sql

# 3. Criar location_event particionada + heatmap_cell_5m
psql "$DATABASE_URL" -f prisma/migrations/002_location_event.sql

# 4. No-op (placeholder para DDL futuro)
psql "$DATABASE_URL" -f prisma/migrations/003_friend_edge.sql
```

Ou use o script npm:
```bash
npm run db:migrate
```

## Adicionar nova partição de `location_event`

Partições cobrem um mês cada. Para criar a partição de junho de 2026:

```sql
CREATE TABLE IF NOT EXISTS location_event_2026_06
  PARTITION OF location_event
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

O job `partitionJob` (Part 5) faz isso automaticamente todo dia às 02:00 UTC.

## Dropar partições expiradas

A política de retenção padrão é 30 dias (`LOCATION_EVENT_RETENTION_DAYS`):

```sql
-- Exemplo: dropar partição de abril de 2026 (expirada)
DROP TABLE IF EXISTS location_event_2026_04;
```

**Nunca use `DROP TABLE` sem `IF EXISTS` em partições — logue o que foi dropado antes.**

## Reads/Writes espaciais

Nunca use o Prisma para queries com `geom`/`geog`. Use sempre o `pgPool` de `src/db/pg.ts`:

```typescript
import { pgPool } from '../db/pg.js'

const { rows } = await pgPool.query(`
  SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat
  FROM live_location
  WHERE user_id = $1
`, [userId])
```
