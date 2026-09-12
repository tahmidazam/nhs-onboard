#!/usr/bin/env bash
# Flattens data/idd.sqlite to CSV so the seeder needs no native sqlite binding.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f data/idd.sqlite ] || { echo "data/idd.sqlite missing. Ask a teammate."; exit 1; }
sqlite3 -header -csv data/idd.sqlite \
  "select k as key, name as brand, ing as generic from d where ing != '' and name not like '(%';" \
  > data/idd.csv
wc -l < data/idd.csv | xargs echo "rows:"
