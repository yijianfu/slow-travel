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
