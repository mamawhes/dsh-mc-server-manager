#!/bin/sh
echo "[12:00:00] [Server thread/INFO]: Starting minecraft server version 1.21.4"
sleep 0.3
echo "[12:00:01] [Server thread/INFO]: Done (0.312s)! For help, type \"help\""
while IFS= read -r line; do
  echo "[12:00:02] [Server thread/INFO]: $line"
  if [ "$line" = "stop" ]; then echo "[12:00:03] [Server thread/INFO]: Stopping server"; exit 0; fi
done
