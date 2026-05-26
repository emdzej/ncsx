#!/usr/bin/env bash
set -euo pipefail

OTP="${1:?Usage: $0 <otp>}"

packages=(
  @emdzej/ncsx-daten
  @emdzej/ncsx-pfl
  @emdzej/ncsx-options
  @emdzej/ncsx-predicate
  @emdzej/ncsx-trace
  @emdzej/ncsx-identity
  @emdzej/ncsx-wire
  @emdzej/ncsx-function-list
  @emdzej/ncsx-chassis
  @emdzej/ncsx-patches
  @emdzej/ncsx-text-tables
  @emdzej/ncsx-ecu-select
  @emdzej/ncsx-inpax-cabi-provider
  @emdzej/ncsx-property-formulas
  @emdzej/ncsx-coder
  @emdzej/ncsx-fa-asw
  @emdzej/ncsx-translations
  @emdzej/ncsx-cabd
)

for pkg in "${packages[@]}"; do
  echo "=== $pkg ==="
  npm trust github "$pkg" --repo=emdzej/ncsx --file=publish.yml --otp="$OTP" -y
done
