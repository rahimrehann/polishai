#!/bin/sh
# Builds the key-pressing helper twice: once for Apple Silicon Macs, once for Intel Macs.
# The installer for each kind of Mac includes the matching one.
set -e
cd "$(dirname "$0")/.."
mkdir -p native/build/arm64 native/build/x64
swiftc -O -target arm64-apple-macosx12.0 -o native/build/arm64/polish-keys native/polish-keys.swift
swiftc -O -target x86_64-apple-macosx12.0 -o native/build/x64/polish-keys native/polish-keys.swift
file native/build/arm64/polish-keys native/build/x64/polish-keys | sed 's#native/build/##'
