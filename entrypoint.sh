#!/bin/sh
# Fix DNS resolution - systemd-resolved chain breaks inside Docker
echo "nameserver 8.8.8.8" > /etc/resolv.conf
echo "nameserver 1.1.1.1" >> /etc/resolv.conf

exec node wordpress-mcp-server.js
