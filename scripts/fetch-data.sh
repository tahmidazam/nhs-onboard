#!/usr/bin/env bash
# Large datasets, gitignored. Small ones (formulary.json, bd_medicines.csv) are committed.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
fetch () { [ -f "data/$1" ] && echo "have $1" || { echo "fetching $1"; curl -sL -o "data/$1" "$2"; }; }
fetch indian_medicines.csv "https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/DATA/indian_medicine_data.csv"
fetch bnf.csv "https://opendata.nhsbsa.net/dataset/29d25de3-02cd-4755-9dee-cdc37e37b5f3/resource/e4f8df82-1c6f-49a3-b832-fa06429d1db9/download/bnf_code_current_202508_version_88_final.csv"
echo "note: data/idd.sqlite (51MB, international brands) is not auto-fetched — ask a teammate."
ls -lh data/
