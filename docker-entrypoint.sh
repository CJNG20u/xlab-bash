#!/bin/sh
# Make sure the bind-mounted data folder is writable by the unprivileged
# "node" user (Docker creates ./data as root on first start), then drop root.
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
