#!/usr/bin/env bash
# 部署产物的唯一清单。pages.yml 调它，本地闸（tools/deploy-set.mjs）也调它。
#
# 为什么要抽出来：这个仓没有打包器，站点=一次文件拷贝，而"拷哪些"以前只写在 workflow 的
# run: 里（index.html/css/js 三行）。本地 index.html 直读仓库根，永远是对的；线上却是按那份
# 手抄清单拷出来的。清单一落后，页面引用的文件就逐个 404——上一轮线上缺的就是
# manifest.webmanifest、sw.js、icons/ 全套、assets/textures/*（含 CSS 里那张夜底纹
# night-field.png），而仓里 165 项文档断言加 77 项引擎断言一条都不红：没有任何一步在
# "只拷三个路径"的那个环境下加载过页面。
#
# 现在清单只有一份：改了页面没改这里，`node tools/deploy-set.mjs` 就红。
#
# 用法：tools/assemble-site.sh <目标目录>     （目标目录不存在就建）
set -u
DEST=${1:?usage: tools/assemble-site.sh <dest-dir>}
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE" || exit 2
mkdir -p "$DEST" || { echo "cannot create $DEST" >&2; exit 2; }

# 进站点的：浏览器会去要的东西，一个都不落。
cp index.html manifest.webmanifest sw.js "$DEST/"
cp -r css js icons assets "$DEST/"
rm -rf "$DEST/assets/gen"

# 不进站点的（有意为之，别"顺手加上"）：
#   server.cjs / electron/   本地与桌面形态的宿主，浏览器用不到
#   tools/                   闸与台架
#   README.md DESIGN.md      给组织的文档
#   assets/gen/              出图的脚本与清单——线上要的是洗出来的 PNG，不是 Python
