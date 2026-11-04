#!/bin/sh
# Wrapper: prefer IPv6 for Mojang auth endpoints (IPv4 edge .133 is blocked).
exec "/Users/mamawhes/.dsh/minecraft/java/corretto-25-aarch64/bin/java" -Djava.net.preferIPv6Addresses=true "$@"
