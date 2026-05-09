# api.hypemap

Backend do HypeMap — API REST + WebSocket para o mapa social de grupos em tempo real.

**Stack:** Node.js 22 · TypeScript strict · Fastify v5 · Prisma 6 · PostgreSQL 16 + PostGIS 3 · Redis 7 · Socket.IO v4

---

## Pré-requisitos

- Node.js 22+
- PostgreSQL 16 com extensão PostGIS 3
- Redis 7

### Instalar PostGIS (Ubuntu/Debian)

```bash
sudo apt install postgresql-16-postgis-3
```

---

## Setup do banco de dados (primeira vez)

```bash
# Criar role e banco
sudo -u postgres psql -c "CREATE ROLE hypemap WITH LOGIN PASSWORD 'hypemap' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE hypemap OWNER hypemap;"
sudo -u postgres psql -d hypemap -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Permitir autenticação md5 via TCP
echo "host hypemap hypemap 127.0.0.1/32 md5" | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
sudo systemctl reload postgresql

# Validar
psql "postgresql://hypemap:hypemap@127.0.0.1:5432/hypemap" -c "SELECT PostGIS_Version();"
```

---

## Quickstart

```bash
# 1. Clonar e instalar dependências
git clone <repo>
cd api.hypemap
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env: ajustar DATABASE_URL, REDIS_URL, e gerar chaves JWT

# 3. Gerar chaves RSA para JWT
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
# Copiar o conteúdo das chaves para .env (JWT_PRIVATE_KEY e JWT_PUBLIC_KEY)

# 4. Criar tabelas e rodar migrações
npx prisma db push
npm run db:migrate

# 5. Iniciar em modo desenvolvimento
npm run dev
```

O servidor sobe em `http://localhost:3000`.

---

## Variáveis de ambiente

| Variável | Descrição | Exemplo |
|---|---|---|
| `DATABASE_URL` | Connection string PostgreSQL | `postgresql://hypemap:hypemap@127.0.0.1:5432/hypemap` |
| `REDIS_URL` | Connection string Redis | `redis://localhost:6379` |
| `JWT_PRIVATE_KEY` | Chave privada RSA (PEM, `\n` escapado) | `-----BEGIN RSA PRIVATE KEY-----\n...` |
| `JWT_PUBLIC_KEY` | Chave pública RSA (PEM, `\n` escapado) | `-----BEGIN PUBLIC KEY-----\n...` |
| `PORT` | Porta HTTP (padrão: 3000) | `3000` |
| `NODE_ENV` | Ambiente | `development` \| `production` \| `test` |
| `LOCATION_EVENT_RETENTION_DAYS` | Retenção de histórico de localização (padrão: 30) | `30` |

---

## Scripts npm

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor em modo watch (tsx) |
| `npm run build` | Compila TypeScript → `dist/` |
| `npm start` | Inicia build compilada |
| `npm test` | Roda testes Jest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | `prisma db push` |
| `npm run db:migrate` | Roda os 3 scripts SQL raw |

---

## Estrutura do projeto

```
src/
  config/env.ts         ← Zod: validação de variáveis de ambiente
  db/prisma.ts          ← PrismaClient singleton
  db/pg.ts              ← pg.Pool para queries espaciais + LISTEN/NOTIFY
prisma/
  schema.prisma         ← Models ORM (User, FriendEdge, ConsentLog, Squad...)
  migrations/           ← Scripts SQL raw (PostGIS, partições)
  README.md             ← Guia de migrações e particionamento
tests/
  integration/          ← Testes reais contra PostgreSQL
docker-compose.yml      ← PostgreSQL/PostGIS + Redis (quando Docker disponível)
```

---

## Migrações

Ver [prisma/README.md](prisma/README.md) para detalhes sobre a estratégia híbrida Prisma + raw SQL e como gerenciar partições de `location_event`.

---

## Testes

Os testes de integração requerem o banco de dados configurado com `DATABASE_URL` em `.env.test`:

```bash
npm test
```

---

## Docker (alternativo ao setup manual)

Se Docker estiver disponível:

```bash
docker compose up -d
# PostgreSQL em :5432, Redis em :6379
```

---

## Próximos passos (Parts 2–5)

- **Part 2:** Auth Service — JWT RS256, register/login/refresh, DELETE /users/me
- **Part 3:** Location Ingest API — POST /locations, GET /map/friends, Squads
- **Part 4:** WebSocket Presence Gateway — Socket.IO v4, Redis adapter, fan-out
- **Part 5:** Background Jobs — heatmap, partition lifecycle, health endpoint, Dockerfile
