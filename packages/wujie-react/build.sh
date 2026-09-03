#!/usr/bin/env bash

cd $(dirname $0)

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}============WujieReact开始编译============${NC}"

[ -d lib ] && rm -rf lib
[ -d esm ] && rm -rf esm

pnpm run lib

echo -e "${GREEN}============WujieReact编译成功============${NC}"
