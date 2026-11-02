#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================="
echo "  國英數複習平台"
echo "=========================================="
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "找不到 Node.js，請先到 https://nodejs.org 下載安裝 LTS 版，裝好後再點兩下這個檔案。"
  read -r -p "按 Enter 關閉"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo
  echo "第一次啟動，正在安裝需要的套件，大約 1～3 分鐘，請稍候……"
  if ! npm install; then
    echo "安裝失敗，請確認電腦有連上網路後再試一次。"
    read -r -p "按 Enter 關閉"
    exit 1
  fi
fi
echo
echo "啟動中……瀏覽器會自動打開。"
echo "學生端：http://localhost:3000"
echo "審核後台：http://localhost:3000/admin"
echo
echo "※ 使用期間請不要關閉這個視窗；要關閉平台時，按 Ctrl + C 或直接關掉視窗。"
echo
(sleep 3; open http://localhost:3000) &
npm start
