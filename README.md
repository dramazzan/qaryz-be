# Qaryz Backend

## Local development

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

The API listens on `http://localhost:4000` by default.

## Docker

Build only the backend:

```bash
docker build -t qaryz-backend .
```

Run the full local stack from this folder:

```bash
docker compose up --build
```

For Render, set the service root directory to `backend`, use Docker deployment, and set the backend environment variables from `.env.example`.

MongoDB Atlas must allow connections from the Render backend. In Atlas, open Network Access and add the Render outbound IPs, or add `0.0.0.0/0` while testing.
