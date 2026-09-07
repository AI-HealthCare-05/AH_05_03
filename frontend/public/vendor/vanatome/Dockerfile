FROM nginx:1.29-alpine

LABEL com.ieobom.service="anatomy-assets"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html/vendor/vanatome

HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1/vendor/vanatome/ATTRIBUTION.txt || exit 1
