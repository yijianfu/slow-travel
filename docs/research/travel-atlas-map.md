# 「慢慢走」旅行地图来源

首页使用项目内的 `slow-travel/dist/assets/china-map.svg`。底图根据 Natural Earth 的公有领域地理矢量制作，采用数据集中 `ADM0_A3_CN` 标识的中国区域、海岸线、河流和部分省级边界作为城市索引的背景。[Natural Earth 使用条款](https://www.naturalearthdata.com/about/terms-of-use/)

地图输入文件固定为 Natural Earth Vector `v5.1.2` 版本。下表的 SHA-256 对应下载的原始 GeoJSON 文件。[版本目录](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson)

| 地理图层 | 原始文件 SHA-256 |
| --- | --- |
| [陆地](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson) | `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9` |
| [河流中心线](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_rivers_lake_centerlines.geojson) | `55aa4497405afc07cdc931b7fbe062c4d6693ba2a550c0d24899953f5d507c8d` |
| [区域轮廓](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson) | `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f` |
| [省级区划线](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_1_states_provinces_lines.geojson) | `72cca93c850d412628a5da4bc5ebfe21ba4d376eb34611bde6b623ee73f0fdcf` |

## 城市标记定位

地图覆盖东经 68° 至 140°、北纬 16° 至 56°，SVG 的 `viewBox` 为 `0 0 648 440`。对于经度 `lon`、纬度 `lat`，图中位置为 `x = (lon - 68) × 9`，`y = (56 - lat) × 11`。HTML 叠加标记时应保持图像宽高比，水平百分比取 `x / 648`，垂直百分比取 `y / 440`。

南京市级索引点采用北纬 32.06167°、东经 118.77778°，对应 SVG 中的 `(457.00, 263.32)`。这个点用于打开城市手账。景区具体入口与步行导航需要各自的地点坐标。[GeoNames 南京条目](https://www.geonames.org/1799962/nanjing.html)

2026-11-04 起，城市标记从手账实时生成。离线坐标索引来自 GeoNames 的 cities15000 数据集，提取其中中国大陆及港澳台城市的中文名、英文名和别名。数据遵循 CC BY 4.0，地图下方显示归属链接。[数据与许可说明](https://download.geonames.org/export/dump/readme.txt)

本次原始下载包 SHA-256 为 `1d7cf2e7b0920b5203a5c0f2b3825e5e5d6e721e3802593cb51b438877796847`。浏览器使用 `assets/cities.js`，匹配和投影在 `assets/city-map.js`。同名记录优先采用较高行政层级，同级人口明显较大的城市优先，仍有歧义的名称暂不定位。市名后缀及省名前缀可规范化，同城多次旅行归并为一个入口。未匹配或超出当前地图范围的城市仍保留在列表，并显示尚未定位提示。[原始下载地址](https://download.geonames.org/export/dump/cities15000.zip)
