server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  server_tokens off;

  # HTML must never be stale: it is what points at everything else.
  location ~* \.html$ { add_header Cache-Control "no-cache" always; }
  location = / { add_header Cache-Control "no-cache" always; }

  location = /health {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    return 200 '{"ok":true,"status":"ok","service":"octopus-{{SLUG}}"}';
  }

  # Written into the image by the Dockerfile. Never cache a deploy check.
  location = /api/build {
    default_type application/json;
    add_header Cache-Control "no-store" always;
  }

  # No build step, so filenames are not content-hashed: short TTL plus revalidation.
  location ~* \.(css|js)$ { add_header Cache-Control "public, max-age=300, must-revalidate" always; }
  location ~* \.(png|jpg|jpeg|gif|svg|ico|woff2?)$ { add_header Cache-Control "public, max-age=86400" always; }

  location / { try_files $uri $uri/ =404; }
}
