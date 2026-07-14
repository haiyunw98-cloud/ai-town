# 灯塔镇视觉资产来源

`tileset.svg` 与 `residents.svg` 是本项目为灯塔镇原创的确定性像素矢量资产，由 `scripts/generate-lighthouse-assets.mjs` 在 2026-07-14 生成。

制作要求：32 像素网格、江南水乡建筑、中央灯塔、黛青/米白/朱砂/暖灯黄配色、八个四方向人物槽位。资产没有复制或描摹第三方图像，也没有包含商标、受限字体或外部素材。

重新生成：

```bash
node scripts/generate-lighthouse-assets.mjs
```

生成脚本和输出随本项目按 MIT 许可证分发。上游 AI Town 自带但未被这些文件复制的资产仍遵循其原始署名和许可证说明。
