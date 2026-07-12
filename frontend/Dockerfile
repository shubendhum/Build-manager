FROM node:20-alpine AS build

WORKDIR /app/frontend

# Copy package files first
COPY package.json ./
RUN yarn install

# Copy source and build
COPY . .
# Leave empty so frontend uses relative /api path (proxied by nginx to backend)
ENV REACT_APP_BACKEND_URL=
RUN yarn build

# Serve with nginx
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
