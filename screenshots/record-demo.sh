#!/bin/bash
set -e
CLI="node /Users/yuanjiwei/Documents/GitHub/runbrowser/packages/cli/bin.js"

echo "🎬 RunBrowser Demo - Start screen recording now, then press Enter"
read

echo "━━━ Step 1: Navigate to Example.com ━━━"
$CLI navigate https://example.com
sleep 2

echo "━━━ Step 2: Take snapshot ━━━"
$CLI snapshot -i
sleep 1

echo "━━━ Step 3: Click 'Learn more' link ━━━"
$CLI click @e1
sleep 2

echo "━━━ Step 4: Go back ━━━"
$CLI back
sleep 2

echo "━━━ Step 5: Navigate to Google ━━━"
$CLI navigate https://www.google.com
sleep 2

echo "━━━ Step 6: Get snapshot ━━━"
$CLI snapshot -i | head -10
sleep 1

echo "━━━ Step 7: Search ━━━"
$CLI navigate "https://www.google.com/search?q=RunBrowser+browser+automation"
sleep 3

echo "━━━ Step 8: Extract results ━━━"
$CLI eval "JSON.stringify([...document.querySelectorAll('#search a h3')].slice(0,5).map((h,i)=>({rank:i+1,title:h.textContent})))"
sleep 2

echo "━━━ Step 9: Navigate to Hacker News ━━━"
$CLI navigate https://news.ycombinator.com
sleep 2

echo "━━━ Step 10: Scroll down ━━━"
$CLI scroll down
sleep 1
$CLI scroll down
sleep 1

echo "━━━ Step 11: Get page title ━━━"
$CLI get title

echo ""
echo "🎬 Demo complete! Stop screen recording."
