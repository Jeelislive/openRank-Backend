# OpenRank Backend Server

NestJS backend server for OpenRank project finder using Supabase (PostgreSQL).

## Setup

1. **Create Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create a new project
   - Get your database connection string from Settings → Database

2. **Install dependencies:**
```bash
npm install
```

3. **Configure database in `.env`**:
```env
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

4. **Run the server** (TypeORM will auto-create tables in development):
```bash
npm run start:dev
```

For detailed Supabase setup instructions, see [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)

## API Endpoints

### Projects
- `GET /api/projects` - Get all projects with filters
  - Query params: `category`, `language`, `sortBy`, `minStars`, `search`

### Stats
- `GET /api/stats` - Get platform statistics

### Categories
- `GET /api/categories` - Get all unique categories

### Languages
- `GET /api/languages` - Get all unique languages

## Database Schema

### Projects Table
- `id` - Primary key
- `name` - Project name
- `description` - Project description
- `rank` - Project rank
- `tags` - Array of tags (stored as simple-array)
- `stars` - Number of stars
- `forks` - Number of forks
- `status` - Project status (Active/Inactive)
- `language` - Primary language
- `category` - Project category
- `lastUpdated` - Last update date
- `contributors` - Number of contributors

## Development

```bash
# Development mode with hot reload
npm run start:dev

# Production build
npm run build
npm run start:prod
```

