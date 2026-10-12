# Portainer git stack. Pushing to main ships to production (estate rule).
# No `ports:`: the reverse proxy reaches this over web_proxy by container name.
services:
  octopus-{{SLUG}}:
    build: .
    container_name: octopus-{{SLUG}}
    restart: always
    networks:
      - web_proxy
      - octopus_network

networks:
  web_proxy:
    name: web_proxy
    external: true
  octopus_network:
    name: octopus_network
    external: true
