#!/usr/bin/env bash
# Downloads reference datasets into data/. Nothing here is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

fetch () {
  if [ -f "data/$1" ]; then
    echo "have    $1"
  else
    echo "fetch   $1"
    curl -fsSL -o "data/$1" "$2"
  fi
}

fetch bd_medicines.csv    "https://huggingface.co/datasets/Mahadih534/all-Bangladeshi-medicines/resolve/main/medicine.csv"
fetch indian_medicines.csv "https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/DATA/indian_medicine_data.csv"
fetch sim.json            "https://sim.animahacks.com/openapi.json"

# The Cambridge and Peterborough formulary sets robots.txt to Disallow: /.
# scripts/scrape-formulary.ts pulls it once; the result is cached here.
if [ ! -f data/formulary.json ]; then
  echo "missing data/formulary.json. Run: pnpm exec tsx scripts/scrape-formulary.ts"
fi

ls -lh data/
