# Static Sans Comic. nginx listens on 8080 as the nginx user.
FROM nginxinc/nginx-unprivileged:1.28-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.css app.js engine.js share.js reader.js room.js manifest.js /usr/share/nginx/html/
COPY art /usr/share/nginx/html/art
COPY fonts /usr/share/nginx/html/fonts
COPY vendor /usr/share/nginx/html/vendor

EXPOSE 8080
