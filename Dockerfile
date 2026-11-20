# Build the Vite application in a dedicated stage.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Supabase publishable configuration is intentionally bundled into the browser app by Vite.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN npm run build

# Serve the compiled SPA with Nginx; no Node runtime is needed in production.
FROM nginx:stable-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 10000
CMD ["nginx", "-g", "daemon off;"]
